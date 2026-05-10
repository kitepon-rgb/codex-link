#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function usage() {
  console.log(`Usage:
  node scripts/codex-app-server-ws-smoke.mjs [options]

Options:
  --cwd <path>           Thread cwd. Defaults to current working directory.
  --model <model>        Optional model override for thread/start.
  --timeout-ms <number>  Overall timeout. Defaults to 60000.
  --out <path>           Output JSONL log path. Defaults to tmp/codex-app-server-smoke/<timestamp>-ws.jsonl.
  -h, --help             Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    cwd: root,
    model: null,
    timeoutMs: 60000,
    out: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--cwd") {
      args.cwd = path.resolve(requireValue(argv, ++index, arg));
    } else if (arg === "--model") {
      args.model = requireValue(argv, ++index, arg);
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(requireValue(argv, ++index, arg));
      if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0) {
        throw new Error("--timeout-ms must be a positive integer");
      }
    } else if (arg === "--out") {
      args.out = path.resolve(requireValue(argv, ++index, arg));
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

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function now() {
  return new Date().toISOString();
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForReady(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting. Keep polling until the explicit timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const outPath = args.out ?? path.join(
    root,
    "tmp",
    "codex-app-server-smoke",
    `${timestampForPath()}-ws.jsonl`,
  );
  const tokenPath = path.join(
    root,
    "tmp",
    "codex-app-server-smoke",
    `${timestampForPath()}-ws-token.txt`,
  );
  const token = randomBytes(32).toString("base64url");
  await mkdir(path.dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, token, { mode: 0o600 });

  const port = await getFreePort();
  const listenUrl = `ws://127.0.0.1:${port}`;
  const transcript = [];
  const pending = new Map();
  const notifications = [];
  let nextId = 1;
  let processExited = false;
  let ws = null;

  const proc = spawn("codex", [
    "app-server",
    "--listen",
    listenUrl,
    "--ws-auth",
    "capability-token",
    "--ws-token-file",
    tokenPath,
  ], {
    cwd: args.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const timeout = setTimeout(() => {
    fail(new Error(`Timed out after ${args.timeoutMs}ms`));
  }, args.timeoutMs);

  function record(direction, payload) {
    transcript.push({ ts: now(), direction, payload });
  }

  function send(message) {
    record("client", message);
    ws.send(JSON.stringify(message));
  }

  function request(method, params = {}) {
    const id = nextId;
    nextId += 1;
    send({ method, id, params });
    return new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
    });
  }

  function notify(method, params = {}) {
    send({ method, params });
  }

  async function finish(summary) {
    clearTimeout(timeout);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (!processExited) {
      proc.kill("SIGTERM");
    }
    await writeTranscript(outPath, transcript);
    console.log(JSON.stringify({
      ok: true,
      out: path.relative(root, outPath),
      listenUrl,
      ...summary,
    }, null, 2));
  }

  async function fail(error) {
    clearTimeout(timeout);
    for (const pendingRequest of pending.values()) {
      pendingRequest.reject(error);
    }
    pending.clear();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    if (!processExited) {
      proc.kill("SIGTERM");
    }
    await writeTranscript(outPath, transcript);
    console.error(JSON.stringify({
      ok: false,
      out: path.relative(root, outPath),
      listenUrl,
      error: error.message,
    }, null, 2));
    process.exitCode = 1;
  }

  proc.stdout.on("data", (chunk) => {
    record("server-stdout", chunk.toString("utf8"));
  });

  proc.stderr.on("data", (chunk) => {
    record("server-stderr", chunk.toString("utf8"));
  });

  proc.on("exit", (code, signal) => {
    processExited = true;
    if (code !== 0 && code !== null) {
      fail(new Error(`codex app-server exited early with code ${code}`));
    }
    record("server-exit", { code, signal });
  });

  try {
    await waitForReady(`http://127.0.0.1:${port}/readyz`, Math.min(args.timeoutMs, 15000));

    const unauthorizedRejected = await assertUnauthorizedRejected(listenUrl);

    ws = new WebSocket(listenUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        record("server-parse-error", { data: event.data, error: error.message });
        fail(new Error(`Could not parse app-server WebSocket message: ${error.message}`));
        return;
      }

      record("server", message);
      if (typeof message.id === "number") {
        const pendingRequest = pending.get(message.id);
        if (!pendingRequest) {
          notifications.push(message);
          return;
        }
        pending.delete(message.id);
        if (message.error) {
          pendingRequest.reject(new Error(`${pendingRequest.method} failed: ${message.error.message}`));
        } else {
          pendingRequest.resolve(message.result);
        }
        return;
      }
      notifications.push(message);
    });

    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
    });

    const initialize = await request("initialize", {
      clientInfo: {
        name: "codex_link_ws_smoke",
        title: "Codex Link WebSocket Smoke Test",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    notify("initialized");

    const models = await request("model/list", { limit: 20, includeHidden: false });
    const threadParams = {
      cwd: args.cwd,
      serviceName: "codex_link_ws_smoke",
    };
    if (args.model) {
      threadParams.model = args.model;
    }

    const threadStart = await request("thread/start", threadParams);
    const threadId = threadStart?.thread?.id;
    if (!threadId) {
      throw new Error("thread/start response did not include thread.id");
    }

    await finish({
      initialized: Boolean(initialize),
      unauthorizedRejected,
      modelCount: models?.data?.length ?? null,
      defaultModel: models?.data?.find((model) => model.isDefault)?.id ?? null,
      threadId,
      notificationMethods: [...new Set(notifications.map((message) => message.method).filter(Boolean))],
    });
  } catch (error) {
    await fail(error);
  }
}

function assertUnauthorizedRejected(listenUrl) {
  return new Promise((resolve, reject) => {
    const unauthenticated = new WebSocket(listenUrl);
    let settled = false;

    function succeed() {
      if (settled) return;
      settled = true;
      resolve(true);
    }

    function fail() {
      if (settled) return;
      settled = true;
      reject(new Error("Unauthenticated WebSocket connection was not rejected"));
    }

    const timer = setTimeout(() => {
      try {
        unauthenticated.close();
      } catch {
        // Nothing useful to do while failing the smoke test.
      }
      fail();
    }, 3000);

    unauthenticated.addEventListener("error", () => {
      clearTimeout(timer);
      succeed();
    }, { once: true });

    unauthenticated.addEventListener("close", () => {
      clearTimeout(timer);
      succeed();
    }, { once: true });

    unauthenticated.addEventListener("open", () => {
      unauthenticated.send(JSON.stringify({
        method: "initialize",
        id: 999,
        params: {
          clientInfo: {
            name: "codex_link_ws_smoke_unauthenticated_probe",
            title: "Codex Link WebSocket Smoke Unauthenticated Probe",
            version: "0.1.0",
          },
        },
      }));
      setTimeout(() => {
        try {
          unauthenticated.close();
        } catch {
          // Nothing useful to do while failing the smoke test.
        }
        fail();
      }, 250);
    }, { once: true });

    unauthenticated.addEventListener("message", () => {
      clearTimeout(timer);
      try {
        unauthenticated.close();
      } catch {
        // Nothing useful to do while failing the smoke test.
      }
      fail();
    }, { once: true });
  });
}

async function writeTranscript(outPath, transcript) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    `${transcript.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
