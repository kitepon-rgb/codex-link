#!/usr/bin/env node
import { writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { loadMacHostConfig } from "./config.js";
import { readCodexAppServerCapabilities } from "./capabilities.js";
import { startMacHostCodexLoopbackWebSocket } from "./codex.js";
import { MacHostRelayClient } from "./relay-client.js";
import { MacHostSessionRunner } from "./session.js";
import {
  VscodeIpcClient,
  defaultVscodeIpcSocketPath,
  vscodeIpcSocketAvailable,
} from "./vscode-ipc.js";

const configPath = process.argv.slice(2).find((argument) => argument !== "--");
const config = await loadMacHostConfig(configPath);
let runner: MacHostSessionRunner | null = null;
const relay = new MacHostRelayClient({
  config,
  onHostMessage: (payload) => {
    void runner?.handleCommand(payload).catch((error: unknown) => {
      relay.sendHostEvent({
        type: "error.reported",
        scope: "host",
        message: error instanceof Error ? error.message : String(error),
      });
    });
  },
  onClose: (code, reason) => {
    console.error(`Relay WebSocket closed (code=${code} reason=${reason}). Exiting for launchd to restart.`);
    process.exit(1);
  },
});
const {
  client: codex,
  url: codexAppServerUrl,
  port: codexAppServerPort,
  childProcess: codexAppServerProcess,
} = await startMacHostCodexLoopbackWebSocket({
  config,
  clientOptions: {
    onNotification: (message) => runner?.handleCodexNotification(message),
    onServerRequest: (message) => runner?.handleCodexServerRequest(message),
  },
});
const vscodeIpcSocketPath = defaultVscodeIpcSocketPath();
let vscodeIpc: VscodeIpcClient | null = null;

async function tryConnectVscodeIpc(): Promise<VscodeIpcClient | null> {
  if (!vscodeIpcSocketAvailable(vscodeIpcSocketPath)) {
    return null;
  }
  try {
    return await VscodeIpcClient.connect({
      clientType: "codex-link-mac-host",
      socketPath: vscodeIpcSocketPath,
      onClose: () => {
        console.log("[mac-host] VS Code Codex IPC disconnected; will attempt reconnect when VS Code is available");
        vscodeIpc = null;
        runner?.replaceVscodeIpc(null);
      },
    });
  } catch (error) {
    console.error(
      `[mac-host] VS Code Codex IPC connect failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

vscodeIpc = await tryConnectVscodeIpc();
if (vscodeIpc) {
  console.log(`[mac-host] VS Code Codex IPC connected at ${vscodeIpcSocketPath}; turn forwarding will go through VS Code app-server for live sync`);
} else {
  console.log(
    `[mac-host] VS Code Codex IPC unavailable at ${vscodeIpcSocketPath}. Falling back to spawned stdio app-server; live sync to VS Code will activate automatically when VS Code Codex starts.`,
  );
}

runner = new MacHostSessionRunner({ config, codex, relay, vscodeIpc });

const ipcSupervisor = setInterval(() => {
  if (vscodeIpc && vscodeIpc.isOpen) {
    return;
  }
  if (!vscodeIpcSocketAvailable(vscodeIpcSocketPath)) {
    return;
  }
  void (async () => {
    const reconnected = await tryConnectVscodeIpc();
    if (reconnected) {
      vscodeIpc = reconnected;
      runner?.replaceVscodeIpc(reconnected);
      console.log("[mac-host] VS Code Codex IPC reconnected; live sync to VS Code resumed");
    }
  })();
}, 5000);
ipcSupervisor.unref();

await relay.connect();
await relay.announce();

const appServer = await readCodexAppServerCapabilities(codex, config);

relay.sendHostEvent({
  type: "host.account.updated",
  hostId: config.hostId,
  account: appServer.account.chatgpt,
});

relay.sendHostEvent({
  type: "host.capabilities.updated",
  hostId: config.hostId,
  capabilities: { appServer },
});

const pairingCode = await relay.createPairingCode();
const deepLink = buildPairingDeepLink({
  relayUrl: config.relayUrl,
  hostId: config.hostId,
  code: pairingCode.code,
  email: pairingCode.chatgptAccount?.email ?? null,
});

console.log("");
console.log("=== Codex Link iPhone pairing ===");
console.log(`code: ${pairingCode.code}  (expires ${pairingCode.expiresAt})`);
if (pairingCode.chatgptAccount) {
  console.log(`bound to ChatGPT account: ${pairingCode.chatgptAccount.email}`);
} else {
  console.log("bound to ChatGPT account: (none — Codex CLI is not in chatgpt auth mode)");
}
console.log(`deep link: ${deepLink}`);
console.log("");
console.log(await QRCode.toString(deepLink, { type: "terminal", small: true }));

const runtimeInfoPath = path.join(tmpdir(), "codex-link-app-server.json");
try {
  writeFileSync(
    runtimeInfoPath,
    JSON.stringify({
      url: codexAppServerUrl,
      port: codexAppServerPort,
      hostId: config.hostId,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }, null, 2),
    { mode: 0o600 },
  );
  chmodSync(runtimeInfoPath, 0o600);
} catch (error) {
  console.error(`[mac-host] failed to write ${runtimeInfoPath}: ${error instanceof Error ? error.message : String(error)}`);
}

console.log("");
console.log("=== Codex CLI live attach ===");
console.log(`Codex app-server is listening on ${codexAppServerUrl} (port ${codexAppServerPort}).`);
console.log("Attach Codex CLI TUI to the same app-server for live thread sharing:");
console.log(`  codex tui --remote ${codexAppServerUrl}`);
console.log(`  or:  scripts/codex-link-cli-attach.sh`);
console.log("Threads opened in either client appear live in the other, and iPhone");
console.log("Codex Link sees the same turn stream.");
console.log("");

function shutdown(signal: NodeJS.Signals): void {
  console.log(`[mac-host] received ${signal}; shutting down`);
  try { unlinkSync(runtimeInfoPath); } catch {}
  try { relay.close(); } catch {}
  void codex.close().catch(() => {});
  try {
    codexAppServerProcess.kill("SIGTERM");
    setTimeout(() => {
      if (!codexAppServerProcess.killed) {
        codexAppServerProcess.kill("SIGKILL");
      }
    }, 1500).unref();
  } catch {}
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await new Promise<never>(() => {});

function buildPairingDeepLink(input: {
  relayUrl: string;
  hostId: string;
  code: string;
  email: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("relayUrl", input.relayUrl);
  params.set("hostId", input.hostId);
  params.set("code", input.code);
  if (input.email) {
    params.set("email", input.email);
  }
  return `codexlink://pair?${params.toString()}`;
}
