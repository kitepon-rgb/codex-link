import { loadRelayConfig } from "./config.js";
import { loadRelaySnapshot, startRelayPersistence } from "./persistence.js";
import { RelayService } from "./relay.js";
import { createRelayState } from "./state.js";
import { createRelayHttpServer } from "./websocket.js";

const config = loadRelayConfig();
const state = createRelayState();
const persistence = config.statePath
  ? startRelayPersistence(state, config.statePath, config.stateFlushIntervalMs ?? 2_000)
  : null;

if (config.statePath) {
  try {
    const restored = await loadRelaySnapshot(config.statePath, state);
    if (restored) {
      console.log(
        `Relay snapshot restored from ${config.statePath} (users=${state.users.size}, hosts=${state.hosts.size}, hostAccess=${state.hostAccess.length}, devices=${state.devices.size})`,
      );
    } else {
      console.log(`Relay snapshot not found at ${config.statePath}; starting with empty state`);
    }
  } catch (error) {
    console.error(`Relay snapshot load failed at ${config.statePath}:`, error);
  }
} else {
  console.log("Relay persistence disabled (CODEX_LINK_RELAY_STATE_PATH not set); state is in-memory only");
}

const relay = new RelayService(state, config);
const { httpServer, gateway } = createRelayHttpServer(relay);
const host = process.env.HOST ?? "0.0.0.0";
const port = parsePort(process.env.PORT ?? process.env.CODEX_LINK_PORT ?? "3000");

httpServer.listen(port, host, () => {
  console.log(`Codex Link Relay listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      try {
        await gateway.close();
      } catch (error) {
        console.error("Relay WebSocket gateway close failed", error);
      }
      if (persistence) {
        try {
          await persistence.stop();
        } catch (error) {
          console.error("Relay snapshot final flush failed", error);
        }
      }
      httpServer.close(() => {
        process.exit(0);
      });
    })();
  });
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid Relay port: ${value}`);
  }
  return parsed;
}
