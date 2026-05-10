import { loadRelayConfig } from "./config.js";
import { RelayService } from "./relay.js";
import { createRelayHttpServer } from "./websocket.js";

const config = loadRelayConfig();
const relay = new RelayService(undefined, config);
const { httpServer, gateway } = createRelayHttpServer(relay);
const host = process.env.HOST ?? "0.0.0.0";
const port = parsePort(process.env.PORT ?? process.env.CODEX_LINK_PORT ?? "3000");

httpServer.listen(port, host, () => {
  console.log(`Codex Link Relay listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    gateway
      .close()
      .catch((error: unknown) => {
        console.error("Relay WebSocket gateway close failed", error);
      })
      .finally(() => {
        httpServer.close(() => {
          process.exit(0);
        });
      });
  });
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid Relay port: ${value}`);
  }
  return parsed;
}
