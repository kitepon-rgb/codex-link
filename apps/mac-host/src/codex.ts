import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import {
  createCodexAppServerClient,
  createCodexAppServerWebSocketClient,
  type CodexAppServerClient,
  type CodexAppServerClientOptions,
  type CodexAppServerWebSocketClientOptions,
} from "@codex-link/codex-client";
import type { MacHostConfig } from "./config.js";

export interface StartMacHostCodexAppServerOptions {
  config: MacHostConfig;
  clientOptions?: CodexAppServerClientOptions;
}

export async function startMacHostCodexAppServer({
  config,
  clientOptions = {},
}: StartMacHostCodexAppServerOptions): Promise<CodexAppServerClient> {
  const options: CodexAppServerClientOptions = {
    command: "codex",
    args: ["app-server"],
    ...clientOptions,
    clientInfo: clientOptions.clientInfo ?? {
      name: "codex_link_mac_host",
      title: "Codex Link Mac Host",
      version: "0.0.0",
    },
    experimentalApi: clientOptions.experimentalApi ?? true,
  };
  if (config.projects[0]?.path && !clientOptions.cwd) {
    options.cwd = config.projects[0].path;
  }
  const client = await createCodexAppServerClient(options);
  await client.initialize();
  return client;
}

export interface StartMacHostCodexLoopbackWebSocketResult {
  client: CodexAppServerClient;
  port: number;
  url: string;
  childProcess: ChildProcessWithoutNullStreams;
}

export interface StartMacHostCodexLoopbackWebSocketOptions {
  config: MacHostConfig;
  clientOptions?: Pick<CodexAppServerWebSocketClientOptions, "clientInfo" | "experimentalApi" | "onNotification" | "onServerRequest">;
  startupTimeoutMs?: number;
}

/**
 * Spawn `codex app-server --listen ws://127.0.0.1:0` and connect Mac Host as a
 * WebSocket client. Reading the listen port from the child's stdout banner.
 *
 * Other clients (e.g. `codex tui --remote ws://127.0.0.1:<port>`) can connect
 * to the same app-server for live thread state sharing.
 */
export async function startMacHostCodexLoopbackWebSocket({
  config,
  clientOptions = {},
  startupTimeoutMs = 10_000,
}: StartMacHostCodexLoopbackWebSocketOptions): Promise<StartMacHostCodexLoopbackWebSocketResult> {
  const cwd = config.projects[0]?.path;
  const child = spawn("codex", ["app-server", "--listen", "ws://127.0.0.1:0"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // codex app-server prints the listen banner ("listening on: ws://127.0.0.1:<port>") to stderr.
  const stderrLines = createInterface({ input: child.stderr });

  const port = await new Promise<number>((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (resolved) return;
      reject(new Error(`Timed out waiting for codex app-server WS listen banner after ${startupTimeoutMs}ms`));
    }, startupTimeoutMs);
    timeout.unref?.();
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const onLine = (line: string) => {
      if (!resolved) {
        const match = /ws:\/\/127\.0\.0\.1:(\d+)/.exec(line);
        if (match && match[1]) {
          resolved = true;
          cleanup();
          resolve(Number.parseInt(match[1], 10));
          return;
        }
      }
      if (line.trim().length > 0) {
        console.error(`[mac-host] codex app-server: ${line}`);
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      if (!resolved) {
        reject(new Error(`codex app-server exited before reporting listen port (code=${code}, signal=${signal})`));
      }
    };
    const onError = (error: Error) => {
      cleanup();
      if (!resolved) reject(error);
    };
    stderrLines.on("line", onLine);
    child.once("exit", onExit);
    child.once("error", onError);
  });

  const url = `ws://127.0.0.1:${port}`;
  const wsOptions: CodexAppServerWebSocketClientOptions = {
    url,
    ...clientOptions,
    clientInfo: clientOptions.clientInfo ?? {
      name: "codex_link_mac_host",
      title: "Codex Link Mac Host",
      version: "0.0.0",
    },
    experimentalApi: clientOptions.experimentalApi ?? true,
  };
  const client = await createCodexAppServerWebSocketClient(wsOptions);
  await client.initialize();
  return { client, port, url, childProcess: child };
}
