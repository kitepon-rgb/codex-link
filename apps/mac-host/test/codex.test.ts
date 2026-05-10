import { describe, expect, it } from "vitest";
import { startMacHostCodexAppServer, type MacHostConfig } from "../src/index.js";

describe("startMacHostCodexAppServer", () => {
  it("starts app-server stdio and performs initialize handshake", async () => {
    const notifications: unknown[] = [];
    const client = await startMacHostCodexAppServer({
      config: {
        relayUrl: "ws://127.0.0.1:3000",
        userId: "usr_1" as never,
        deviceId: "dev_1" as never,
        hostId: "host_1" as never,
        hostName: "MacBook",
        projects: [{ id: "project_1" as never, name: "Codex Link", path: process.cwd() }],
      } satisfies MacHostConfig,
      clientOptions: {
        command: process.execPath,
        args: [
          "-e",
          `
          const readline = require("node:readline");
          const rl = readline.createInterface({ input: process.stdin });
          rl.on("line", (line) => {
            const msg = JSON.parse(line);
            if (msg.method === "initialize") {
              process.stdout.write(JSON.stringify({
                id: msg.id,
                result: { initialized: true, client: msg.params.clientInfo.name }
              }) + "\\n");
            }
            if (msg.method === "initialized") {
              process.stdout.write(JSON.stringify({ method: "initialized.seen", params: {} }) + "\\n");
            }
          });
          `,
        ],
        onNotification: (message) => {
          notifications.push(message);
        },
      },
    });

    await waitFor(() => notifications.length > 0);
    expect(notifications).toEqual([{ method: "initialized.seen", params: {} }]);
    await client.close();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for predicate");
}
