#!/usr/bin/env node
import { loadMacHostConfig } from "./config.js";
import { readCodexAppServerCapabilities } from "./capabilities.js";
import { startMacHostCodexAppServer } from "./codex.js";
import { MacHostRelayClient } from "./relay-client.js";
import { MacHostSessionRunner } from "./session.js";

const config = await loadMacHostConfig(process.argv[2]);
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
relay.sendHostEvent({
  type: "host.capabilities.updated",
  hostId: config.hostId,
  capabilities: {
    appServer: await readCodexAppServerCapabilities(codex, config),
  },
});

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
