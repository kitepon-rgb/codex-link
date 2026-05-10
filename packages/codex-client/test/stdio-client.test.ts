import { describe, expect, it } from "vitest";
import { CodexAppServerStdioClient } from "../src/index.js";

describe("CodexAppServerStdioClient", () => {
  it("initializes a JSONL app-server process", async () => {
    const client = new CodexAppServerStdioClient({
      command: process.execPath,
      args: [
        "-e",
        `
        const readline = require("node:readline");
        const rl = readline.createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          if (msg.method === "initialize") {
            process.stdout.write(JSON.stringify({ id: msg.id, result: { ok: true } }) + "\\n");
          }
          if (msg.method === "initialized") {
            process.stdout.write(JSON.stringify({ method: "server.ready", params: {} }) + "\\n");
          }
        });
        `,
      ],
    });

    await client.start();
    await expect(client.initialize()).resolves.toEqual({ ok: true });
    await client.close();
  });

  it("rejects JSON-RPC errors", async () => {
    const client = new CodexAppServerStdioClient({
      command: process.execPath,
      args: [
        "-e",
        `
        const readline = require("node:readline");
        const rl = readline.createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          process.stdout.write(JSON.stringify({
            id: msg.id,
            error: { code: -32000, message: "boom" }
          }) + "\\n");
        });
        `,
      ],
    });

    await client.start();
    await expect(client.request("explode")).rejects.toThrow("boom");
    await client.close();
  });

  it("forwards server-initiated requests separately from responses", async () => {
    const serverRequests: unknown[] = [];
    const client = new CodexAppServerStdioClient({
      command: process.execPath,
      args: [
        "-e",
        `
        const readline = require("node:readline");
        const rl = readline.createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          process.stdout.write(JSON.stringify({
            id: "approval_1",
            method: "item/commandExecution/requestApproval",
            params: { threadId: "thread_1", turnId: "turn_1", itemId: "item_1" }
          }) + "\\n");
          process.stdout.write(JSON.stringify({ id: msg.id, result: { ok: true } }) + "\\n");
        });
        `,
      ],
      onServerRequest: (message) => serverRequests.push(message),
    });

    await client.start();
    await expect(client.request("thread/start", {})).resolves.toEqual({ ok: true });
    expect(serverRequests).toHaveLength(1);
    expect(serverRequests[0]).toMatchObject({
      id: "approval_1",
      method: "item/commandExecution/requestApproval",
    });
    await client.close();
  });

  it("responds to server-initiated requests with the original request id", async () => {
    const notifications: unknown[] = [];
    const client = new CodexAppServerStdioClient({
      command: process.execPath,
      args: [
        "-e",
        `
        const readline = require("node:readline");
        const rl = readline.createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          if (msg.method === "thread/start") {
            process.stdout.write(JSON.stringify({
              id: "approval_1",
              method: "item/commandExecution/requestApproval",
              params: { threadId: "thread_1", turnId: "turn_1", itemId: "item_1" }
            }) + "\\n");
            process.stdout.write(JSON.stringify({ id: msg.id, result: { ok: true } }) + "\\n");
            return;
          }
          if (msg.id === "approval_1") {
            process.stdout.write(JSON.stringify({
              method: "approval.response",
              params: msg.result
            }) + "\\n");
          }
        });
        `,
      ],
      onServerRequest: (message) => {
        client.respondToServerRequest(message.id, { decision: "accept" });
      },
      onNotification: (message) => notifications.push(message),
    });

    await client.start();
    await expect(client.request("thread/start", {})).resolves.toEqual({ ok: true });
    await waitFor(() => notifications.length > 0);
    expect(notifications[0]).toEqual({
      method: "approval.response",
      params: { decision: "accept" },
    });
    await client.close();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
