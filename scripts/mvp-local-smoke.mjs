#!/usr/bin/env node

import { spawn, execFile as execFileCallback } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, hostname } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const requireFromMacHost = createRequire(new URL("../apps/mac-host/package.json", import.meta.url));
const WebSocket = requireFromMacHost("ws");
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function usage() {
  console.log(`Usage:
  node scripts/mvp-local-smoke.mjs [options]

Options:
  --relay-url <url>           Relay URL. Defaults to http://127.0.0.1:3000.
  --bootstrap-token <token>   Host bootstrap token. Defaults to local dev token.
  --project-path <path>       Project path exposed by Host. Defaults to repo root.
  --timeout-ms <number>       Overall timeout. Defaults to 120000.
  --turn                      Also start a real Codex turn and wait for running status.
  --wait-complete             Combined with --turn, also wait for completed/failed/canceled.
                              Verifies the rollout persists to ~/.codex/sessions (one LLM call).
  --reconnect                 After subscribe, drop the WS and resubscribe with afterSequence.
  --revoke-host-access        After the run, owner revokes iPhone HostAccess via HTTP and
                              the iPhone WS must observe HOST_ACCESS_DENIED.
  --full                      Enable --turn, --reconnect, and --revoke-host-access together.
  --keep-compose              Leave Docker compose Relay running after the smoke.
  -h, --help                  Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    relayUrl: "http://127.0.0.1:3000",
    bootstrapToken: "codex-link-local-dev-bootstrap-token",
    projectPath: root,
    timeoutMs: 120000,
    turn: false,
    waitComplete: false,
    reconnect: false,
    revokeHostAccess: false,
    keepCompose: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--relay-url") {
      args.relayUrl = requireValue(argv, ++index, arg);
    } else if (arg === "--bootstrap-token") {
      args.bootstrapToken = requireValue(argv, ++index, arg);
    } else if (arg === "--project-path") {
      args.projectPath = path.resolve(requireValue(argv, ++index, arg));
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(requireValue(argv, ++index, arg));
      if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0) {
        throw new Error("--timeout-ms must be a positive integer");
      }
    } else if (arg === "--turn") {
      args.turn = true;
    } else if (arg === "--wait-complete") {
      args.waitComplete = true;
    } else if (arg === "--reconnect") {
      args.reconnect = true;
    } else if (arg === "--revoke-host-access") {
      args.revokeHostAccess = true;
    } else if (arg === "--full") {
      args.turn = true;
      args.reconnect = true;
      args.revokeHostAccess = true;
    } else if (arg === "--keep-compose") {
      args.keepCompose = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireValue(argv, index, name) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const deadline = Date.now() + args.timeoutMs;
  let hostProcess = null;
  let clientSocket = null;
  let compose = null;
  let startedCompose = false;
  let tempDir = null;
  let configPath = null;
  let keychainRef = null;

  async function cleanup() {
    if (clientSocket) {
      clientSocket.close();
    }
    if (
      hostProcess &&
      hostProcess.exitCode === null &&
      hostProcess.signalCode === null &&
      !hostProcess.killed
    ) {
      hostProcess.kill("SIGTERM");
      await waitForProcessExit(hostProcess, 5000).catch(() => {
        hostProcess.kill("SIGKILL");
      });
    }
    if (keychainRef && process.platform === "darwin") {
      await execFile("security", [
        "delete-generic-password",
        "-s",
        keychainRef.service,
        "-a",
        keychainRef.account,
      ]).catch(() => undefined);
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    if (compose && startedCompose && !args.keepCompose) {
      await run(compose.command, [...compose.args, "down"]);
    }
  }

  process.once("SIGINT", () => {
    cleanup().finally(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    cleanup().finally(() => process.exit(143));
  });

  try {
    compose = await resolveComposeCommand();
    const relayWasHealthy = await healthz(args.relayUrl).catch(() => false);
    if (!relayWasHealthy) {
      await run(compose.command, [...compose.args, "up", "--build", "-d", "relay"]);
      startedCompose = true;
    }
    await waitUntil(() => healthz(args.relayUrl), deadline, "Relay health check");

    tempDir = await mkdtemp(path.join(tmpdir(), "codex-link-mvp-smoke-"));
    const configDir = path.join(tempDir, "config");
    const keychainService = `dev.codex-link.mvp-smoke.${process.pid}`;
    await run("apps/mac-host/scripts/install.sh", [], {
      cwd: root,
      env: {
        ...process.env,
        CODEX_LINK_RELAY_URL: args.relayUrl,
        CODEX_LINK_HOST_BOOTSTRAP_TOKEN: args.bootstrapToken,
        CODEX_LINK_PROJECT_PATH: args.projectPath,
        CODEX_LINK_PROJECT_NAME: path.basename(args.projectPath) || "Codex Link",
        CODEX_LINK_CONFIG_DIR: configDir,
        CODEX_LINK_KEYCHAIN_SERVICE: keychainService,
      },
    });

    configPath = path.join(configDir, "host.json");
    const hostConfig = JSON.parse(await readFile(configPath, "utf8"));
    if (hostConfig.deviceToken !== undefined) {
      throw new Error("Mac Host smoke config unexpectedly contains inline deviceToken");
    }
    keychainRef = hostConfig.deviceTokenKeychain ?? null;

    hostProcess = spawn("pnpm", [
      "--filter",
      "@codex-link/mac-host",
      "start",
      "--",
      configPath,
    ], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const hostOutput = [];
    hostProcess.stdout.on("data", (chunk) => {
      hostOutput.push(chunk.toString("utf8"));
    });
    hostProcess.stderr.on("data", (chunk) => {
      hostOutput.push(chunk.toString("utf8"));
    });
    hostProcess.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        hostOutput.push(`Host exited with code ${code}\n`);
      }
      if (signal) {
        hostOutput.push(`Host exited with signal ${signal}\n`);
      }
    });

    const pairingCode = await waitForPairingCode(hostOutput, hostProcess, deadline);
    const deviceSession = await createDeviceSession(args.relayUrl);
    const pairing = await pairDeviceSession(args.relayUrl, deviceSession, pairingCode);

    const replay = {
      hostOnline: false,
      projects: false,
      capabilities: false,
      subscriptionReady: false,
      threadStarted: false,
      turnRunning: false,
      turnTerminal: null,
      latestRelaySequence: 0,
    };

    let session = await openClientSession({
      relayUrl: args.relayUrl,
      deviceSession,
      hostId: pairing.hostId,
      afterSequence: 0,
      deadline,
    });
    clientSocket = session.socket;
    let reader = session.reader;

    while (!replay.subscriptionReady || !replay.hostOnline || !replay.projects || !replay.capabilities) {
      const message = await reader.read(deadline);
      applyReplayState(replay, message);
    }

    if (args.turn) {
      clientSocket.send(JSON.stringify({
        type: "client.toHost",
        hostId: pairing.hostId,
        payload: {
          type: "codex.turn.start",
          projectId: hostConfig.projects[0].id,
          prompt: "Reply with exactly OK.",
        },
      }));
      while (!replay.threadStarted || !replay.turnRunning) {
        const message = await reader.read(deadline);
        applyReplayState(replay, message);
      }
      if (args.waitComplete) {
        while (!replay.turnTerminal) {
          const message = await reader.read(deadline);
          applyReplayState(replay, message);
        }
      }
    }

    let reconnect = null;
    if (args.reconnect) {
      const beforeSequence = replay.latestRelaySequence;
      clientSocket.close();
      await waitForSocketClose(clientSocket, deadline);

      replay.subscriptionReady = false;
      session = await openClientSession({
        relayUrl: args.relayUrl,
        deviceSession,
        hostId: pairing.hostId,
        afterSequence: beforeSequence,
        deadline,
      });
      clientSocket = session.socket;
      reader = session.reader;

      let replayedEvents = 0;
      while (!replay.subscriptionReady) {
        const message = await reader.read(deadline);
        if (message.type === "host.event") {
          replayedEvents += 1;
        }
        applyReplayState(replay, message);
      }
      reconnect = {
        beforeSequence,
        afterSequence: replay.latestRelaySequence,
        replayedEvents,
      };
    }

    let revoke = null;
    if (args.revokeHostAccess) {
      const ownerToken = await readKeychainToken(hostConfig.deviceTokenKeychain);
      const revocation = await revokeHostAccess(args.relayUrl, {
        ownerUserId: hostConfig.userId,
        ownerDeviceId: hostConfig.deviceId,
        hostId: pairing.hostId,
        targetUserId: deviceSession.userId,
        ownerToken,
      });
      const denial = await reader.readUntil(
        (message) => message.type === "relay.error" && message.code === "HOST_ACCESS_DENIED",
        deadline,
        "HOST_ACCESS_DENIED after revoke",
      );
      revoke = {
        revokedRole: revocation.revokedRole,
        observedCode: denial.code,
      };
    }

    await cleanup();
    console.log(JSON.stringify({
      ok: true,
      relayUrl: args.relayUrl,
      hostId: pairing.hostId,
      deviceId: deviceSession.deviceId,
      pairingRole: pairing.role,
      replay,
      reconnect,
      revoke,
      startedCompose,
      turnSmoke: args.turn,
    }, null, 2));
  } catch (error) {
    await cleanup();
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  }
}

async function resolveComposeCommand() {
  const configured = process.env.CODEX_LINK_COMPOSE_COMMAND;
  if (configured) {
    const [command, ...args] = configured.split(/\s+/).filter(Boolean);
    if (!command) {
      throw new Error("CODEX_LINK_COMPOSE_COMMAND is empty");
    }
    await run(command, [...args, "version"]);
    return { command, args };
  }

  try {
    await run("docker-compose", ["version"]);
    return { command: "docker-compose", args: [] };
  } catch {
    await run("docker", ["compose", "version"]);
    return { command: "docker", args: ["compose"] };
  }
}

async function run(command, args, options = {}) {
  try {
    const result = await execFile(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    return result;
  } catch (error) {
    const stderr = error.stderr ? `\n${error.stderr}` : "";
    const stdout = error.stdout ? `\n${error.stdout}` : "";
    throw new Error(`${command} ${args.join(" ")} failed${stdout}${stderr}`);
  }
}

async function healthz(relayUrl) {
  try {
    const response = await fetch(new URL("/healthz", relayUrl));
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntil(check, deadline, label) {
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await sleep(300);
  }
  throw new Error(`${label} timed out`);
}

async function waitForPairingCode(output, hostProcess, deadline) {
  while (Date.now() < deadline) {
    const text = output.join("");
    const match = text.match(/pairing code:\s*([A-F0-9]{4}-[A-F0-9]{4})/i);
    if (match) {
      return match[1].toUpperCase();
    }
    if (hostProcess.exitCode !== null) {
      throw new Error(`Mac Host exited before printing pairing code:\n${text}`);
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for Mac Host pairing code:\n${output.join("")}`);
}

async function createDeviceSession(relayUrl) {
  const response = await fetch(new URL("/api/device-session", relayUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Smoke iPhone",
      deviceName: `${hostname()} smoke`,
    }),
  });
  if (!response.ok) {
    throw new Error(`device-session failed: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function pairDeviceSession(relayUrl, deviceSession, pairingCode) {
  const response = await fetch(new URL("/api/device-session/pair", relayUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${deviceSession.deviceToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      userId: deviceSession.userId,
      deviceId: deviceSession.deviceId,
      pairingCode,
    }),
  });
  if (!response.ok) {
    throw new Error(`device-session pairing failed: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function clientWebSocketUrl(relayUrl, deviceSession) {
  const url = new URL(relayUrl);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  url.pathname = "/relay";
  url.search = "";
  url.searchParams.set("kind", "client");
  url.searchParams.set("deviceId", deviceSession.deviceId);
  url.searchParams.set("userId", deviceSession.userId);
  return url.toString();
}

function applyReplayState(replay, message) {
  if (message.type === "relay.error") {
    throw new Error(`Relay error ${message.code}: ${message.message}`);
  }
  if (message.type === "host.subscription.ready") {
    replay.subscriptionReady = true;
    if (typeof message.latestSequence === "number") {
      replay.latestRelaySequence = message.latestSequence;
    }
    return;
  }
  if (message.type !== "host.event") {
    return;
  }
  if (typeof message.event?.sequence === "number") {
    replay.latestRelaySequence = Math.max(
      replay.latestRelaySequence ?? 0,
      message.event.sequence,
    );
  }
  const eventType = message.event?.event?.type;
  if (eventType === "host.online") {
    replay.hostOnline = true;
  } else if (eventType === "project.list.updated") {
    replay.projects = true;
  } else if (eventType === "host.capabilities.updated") {
    replay.capabilities = true;
  } else if (eventType === "thread.started") {
    replay.threadStarted = true;
  } else if (eventType === "turn.status.changed") {
    const status = message.event?.event?.status;
    if (status === "running") {
      replay.turnRunning = true;
    } else if (status === "completed" || status === "failed" || status === "canceled") {
      replay.turnTerminal = status;
    }
  }
}

async function openClientSession({ relayUrl, deviceSession, hostId, afterSequence, deadline }) {
  const wsUrl = clientWebSocketUrl(relayUrl, deviceSession);
  const socket = new WebSocket(wsUrl, {
    headers: {
      authorization: `Bearer ${deviceSession.deviceToken}`,
    },
  });
  const reader = new WebSocketReader(socket);
  await reader.open(deadline);
  await reader.readUntil((message) => message.type === "relay.ready", deadline, "relay.ready");
  const subscribe = {
    type: "client.subscribeHost",
    hostId,
  };
  if (afterSequence > 0) {
    subscribe.afterSequence = afterSequence;
  }
  socket.send(JSON.stringify(subscribe));
  return { socket, reader };
}

function waitForSocketClose(socket, deadline) {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeoutMs = Math.max(0, deadline - Date.now());
    const timer = setTimeout(() => reject(new Error("WebSocket close timed out")), timeoutMs);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function readKeychainToken(keychainRef) {
  if (!keychainRef || typeof keychainRef !== "object") {
    throw new Error("Mac Host config does not include a Keychain reference for the device token");
  }
  const { service, account } = keychainRef;
  if (!service || !account) {
    throw new Error("Mac Host Keychain reference is missing service or account");
  }
  if (process.platform !== "darwin") {
    throw new Error("Reading the Mac Host device token requires macOS Keychain");
  }
  const { stdout } = await execFile("/usr/bin/security", [
    "find-generic-password",
    "-s",
    service,
    "-a",
    account,
    "-w",
  ]);
  const token = stdout.trim();
  if (!token) {
    throw new Error("Keychain returned empty Mac Host device token");
  }
  return token;
}

async function revokeHostAccess(relayUrl, params) {
  const response = await fetch(new URL("/api/host-access/revoke", relayUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.ownerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ownerUserId: params.ownerUserId,
      ownerDeviceId: params.ownerDeviceId,
      hostId: params.hostId,
      targetUserId: params.targetUserId,
    }),
  });
  if (!response.ok) {
    throw new Error(`host-access/revoke failed: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

class WebSocketReader {
  constructor(socket) {
    this.socket = socket;
    this.queue = [];
    this.waiters = [];
    this.opened = false;
    this.closed = false;
    this.error = null;

    socket.on("open", () => {
      this.opened = true;
      this.flush();
    });
    socket.on("message", (raw) => {
      this.queue.push(JSON.parse(raw.toString()));
      this.flush();
    });
    socket.on("close", () => {
      this.closed = true;
      this.flush();
    });
    socket.on("error", (error) => {
      this.error = error;
      this.flush();
    });
  }

  open(deadline) {
    return this.waitFor(() => this.opened, deadline, "WebSocket open");
  }

  read(deadline) {
    return this.waitFor(() => {
      if (this.queue.length > 0) {
        return this.queue.shift();
      }
      return null;
    }, deadline, "WebSocket message");
  }

  readUntil(predicate, deadline, label) {
    return this.waitFor(() => {
      const index = this.queue.findIndex(predicate);
      if (index === -1) {
        return null;
      }
      return this.queue.splice(index, 1)[0];
    }, deadline, label);
  }

  waitFor(resolveValue, deadline, label) {
    return new Promise((resolve, reject) => {
      let done = false;
      let timer = null;

      const finish = (callback, value) => {
        if (done) {
          return;
        }
        done = true;
        if (timer) {
          clearTimeout(timer);
        }
        this.waiters = this.waiters.filter((waiter) => waiter !== tick);
        callback(value);
      };

      const tick = () => {
        if (done) {
          return;
        }
        if (this.error) {
          finish(reject, this.error);
          return;
        }
        const value = resolveValue();
        if (value) {
          finish(resolve, value);
          return;
        }
        if (this.closed) {
          finish(reject, new Error(`${label} failed because WebSocket closed`));
          return;
        }
        if (Date.now() >= deadline) {
          finish(reject, new Error(`${label} timed out`));
          return;
        }

        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(tick, Math.max(0, Math.min(250, deadline - Date.now())));
      };

      this.waiters.push(tick);
      tick();
    });
  }

  flush() {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("process exit timed out")), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
