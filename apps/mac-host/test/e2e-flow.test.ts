import type { AddressInfo } from "node:net";
import type { CodexAppServerClient } from "@codex-link/codex-client";
import { createRelayHttpServer, RelayService } from "@codex-link/relay";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  MacHostRelayClient,
  MacHostSessionRunner,
  type MacHostConfig,
} from "../src/index.js";

describe("Codex Link MVP host pairing flow", () => {
  const servers: Array<ReturnType<typeof createRelayHttpServer>> = [];
  const sockets: TestRelaySocket[] = [];
  const hosts: MacHostRelayClient[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.close();
    }
    for (const host of hosts.splice(0)) {
      host.close();
    }
    await Promise.all(
      servers.splice(0).map(
        ({ gateway, httpServer }) =>
          new Promise<void>((resolve, reject) => {
            gateway
              .close()
              .then(() => {
                httpServer.close((error) => {
                  if (error) {
                    reject(error);
                    return;
                  }
                  resolve();
                });
              })
              .catch(reject);
          }),
      ),
    );
  });

  it("routes a paired iPhone turn request through Relay to Mac Host and back as Host events", async () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    const macToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: mac.id }).token;
    const relayUrl = await startRelay(relay, servers);
    const config = {
      relayUrl,
      userId: owner.id,
      deviceId: mac.id,
      deviceToken: macToken,
      hostId: host.id,
      hostName: host.name,
      projects: [{ id: "project_1" as never, name: "Codex Link", path: "/repo" }],
    } satisfies MacHostConfig;
    const codexRequests: Array<{ method: string; params: unknown }> = [];
    const codex = fakeCodexClient(async (method, params) => {
      codexRequests.push({ method, params });
      if (method === "thread/start") {
        return { thread: { id: "thread_1", name: null, preview: "Ship the smoke" } };
      }
      if (method === "turn/start") {
        return { turn: { id: "turn_1", status: "inProgress" } };
      }
      throw new Error(`Unexpected Codex app-server request: ${method}`);
    });
    let runner: MacHostSessionRunner | null = null;
    const hostClient = new MacHostRelayClient({
      config,
      onHostMessage: (payload) => {
        void runner?.handleCommand(payload);
      },
    });
    hosts.push(hostClient);
    runner = new MacHostSessionRunner({ config, codex, relay: hostClient });

    await hostClient.connect();
    const pairingCode = await hostClient.createPairingCode();
    const deviceSession = await createDeviceSession(relayUrl);
    const pairing = await pairDeviceSession(relayUrl, deviceSession, pairingCode.code);
    const clientSocket = await openRelaySocket(
      `${relayUrl}/relay?kind=client&deviceId=${deviceSession.deviceId}&userId=${deviceSession.userId}`,
      deviceSession.deviceToken,
    );
    sockets.push(clientSocket);
    await clientSocket.read();
    clientSocket.send({ type: "client.subscribeHost", hostId: pairing.hostId });
    await readUntilServerMessage(clientSocket, "host.subscription.ready");

    clientSocket.send({
      type: "client.toHost",
      hostId: pairing.hostId,
      payload: {
        type: "codex.turn.start",
        projectId: "project_1",
        prompt: "Ship the smoke",
      },
    });

    expect(await readUntilHostEvent(clientSocket, "thread.started")).toMatchObject({
      type: "host.event",
      event: {
        hostId: pairing.hostId,
        event: {
          type: "thread.started",
          thread: {
            id: "thread_1",
            projectId: "project_1",
            title: "Ship the smoke",
          },
        },
      },
    });
    expect(await readUntilHostEvent(clientSocket, "turn.status.changed")).toMatchObject({
      type: "host.event",
      event: {
        hostId: pairing.hostId,
        event: {
          type: "turn.status.changed",
          turnId: "turn_1",
          status: "running",
        },
      },
    });
    expect(codexRequests).toEqual([
      {
        method: "thread/start",
        params: {
          cwd: "/repo",
          serviceName: "codex-link-mac-host",
          approvalsReviewer: "user",
          experimentalRawEvents: true,
          persistExtendedHistory: false,
        },
      },
      {
        method: "turn/start",
        params: {
          threadId: "thread_1",
          input: [{ type: "text", text: "Ship the smoke", text_elements: [] }],
          cwd: "/repo",
        },
      },
    ]);
  });
});

async function startRelay(
  relay: RelayService,
  servers: Array<ReturnType<typeof createRelayHttpServer>>,
): Promise<string> {
  const server = createRelayHttpServer(relay);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, "127.0.0.1", resolve);
  });
  const address = server.httpServer.address() as AddressInfo;
  return `ws://127.0.0.1:${address.port}`;
}

interface DeviceSessionResponse {
  userId: string;
  deviceId: string;
  deviceToken: string;
}

async function createDeviceSession(relayUrl: string): Promise<DeviceSessionResponse> {
  const response = await fetch(`${httpBaseUrl(relayUrl)}/api/device-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      displayName: "Owner iPhone",
      deviceName: "Owner iPhone",
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as DeviceSessionResponse;
}

interface PairingResponse {
  hostId: string;
}

async function pairDeviceSession(
  relayUrl: string,
  session: DeviceSessionResponse,
  pairingCode: string,
): Promise<PairingResponse> {
  const response = await fetch(`${httpBaseUrl(relayUrl)}/api/device-session/pair`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.deviceToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      userId: session.userId,
      deviceId: session.deviceId,
      pairingCode,
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as PairingResponse;
}

interface TestRelaySocket {
  send(message: unknown): void;
  read(): Promise<unknown>;
  close(): void;
}

function openRelaySocket(url: string, deviceToken: string): Promise<TestRelaySocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    const messages: unknown[] = [];
    const readers: Array<(message: unknown) => void> = [];
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as unknown;
      const reader = readers.shift();
      if (reader) {
        reader(message);
        return;
      }
      messages.push(message);
    });
    socket.once("open", () =>
      resolve({
        send(message: unknown): void {
          socket.send(JSON.stringify(message));
        },
        read(): Promise<unknown> {
          const message = messages.shift();
          if (message) {
            return Promise.resolve(message);
          }
          return new Promise((reader) => {
            readers.push(reader);
          });
        },
        close(): void {
          socket.close();
        },
      }),
    );
    socket.once("error", reject);
  });
}

async function readUntilServerMessage(
  socket: TestRelaySocket,
  messageType: string,
): Promise<unknown> {
  for (let index = 0; index < 10; index += 1) {
    const message = await socket.read();
    if (isObjectWithType(message, messageType)) {
      return message;
    }
  }
  throw new Error(`Timed out waiting for Relay message: ${messageType}`);
}

async function readUntilHostEvent(
  socket: TestRelaySocket,
  eventType: string,
): Promise<unknown> {
  for (let index = 0; index < 10; index += 1) {
    const message = await socket.read();
    if (!isObjectWithType(message, "host.event") || !("event" in message)) {
      continue;
    }
    const cached = message.event as { event?: { type?: string } };
    if (cached.event?.type === eventType) {
      return message;
    }
  }
  throw new Error(`Timed out waiting for Host event: ${eventType}`);
}

function isObjectWithType(value: unknown, type: string): value is { type: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      (value as { type?: unknown }).type === type,
  );
}

function httpBaseUrl(relayUrl: string): string {
  return relayUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
}

function fakeCodexClient(
  requestHandler: (method: string, params?: unknown) => Promise<unknown>,
): CodexAppServerClient {
  return {
    start: async () => undefined,
    initialize: async () => ({}),
    request: requestHandler,
    startThread: (params) => requestHandler("thread/start", params),
    startTurn: (params) => requestHandler("turn/start", params),
    steerTurn: (params) => requestHandler("turn/steer", params),
    interruptTurn: (params) => requestHandler("turn/interrupt", params),
    listModels: (params) => requestHandler("model/list", params),
    listExperimentalFeatures: (params) =>
      requestHandler("experimentalFeature/list", params),
    readConfig: (params) => requestHandler("config/read", params),
    listThreads: (params) => requestHandler("thread/list", params),
    readThread: (params) => requestHandler("thread/read", params),
    listThreadTurns: (params) => requestHandler("thread/turns/list", params),
    respondToServerRequest: () => undefined,
    notify: () => undefined,
    close: async () => undefined,
  };
}
