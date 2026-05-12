#!/usr/bin/env node
import QRCode from "qrcode";
import { loadMacHostConfig } from "./config.js";
import { readCodexAppServerCapabilities } from "./capabilities.js";
import { startMacHostCodexAppServer } from "./codex.js";
import { MacHostRelayClient } from "./relay-client.js";
import { MacHostSessionRunner } from "./session.js";

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
const codex = await startMacHostCodexAppServer({
  config,
  clientOptions: {
    onNotification: (message) => runner?.handleCodexNotification(message),
    onServerRequest: (message) => runner?.handleCodexServerRequest(message),
  },
});
runner = new MacHostSessionRunner({ config, codex, relay });

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

process.on("SIGINT", () => {
  relay.close();
  void codex.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  relay.close();
  void codex.close();
  process.exit(0);
});

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
