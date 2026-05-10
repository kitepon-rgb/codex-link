import type { AddressInfo } from "node:net";
import type { RelayServerMessage } from "../src/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createRelayHttpServer, RelayService } from "../src/index.js";
import { resetIdsForTest } from "../src/id.js";

describe("Relay WebSocket gateway", () => {
  const servers: Array<ReturnType<typeof createRelayHttpServer>> = [];

  beforeEach(() => {
    resetIdsForTest();
  });

  afterEach(async () => {
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

  it("accepts Host WebSocket connections and routes authorized client messages", async () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const iphone = relay.registerDevice(owner.id, "Owner iPhone", "iphone");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    const baseUrl = await startRelay(relay, servers);

    const hostSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=host&deviceId=${mac.id}&hostId=${host.id}`,
    );
    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${iphone.id}&userId=${owner.id}`,
    );
    await hostSocket.read();
    await clientSocket.read();

    clientSocket.send({
      type: "client.toHost",
      hostId: host.id,
      payload: { type: "turn.start", text: "hello" },
    });

    expect(await hostSocket.read()).toEqual({
      type: "host.message",
      message: {
        userId: owner.id,
        hostId: host.id,
        payload: { type: "turn.start", text: "hello" },
      },
    });
    expect(relay.listHostsForUser(owner.id)[0]?.status).toBe("online");
  });

  it("rejects client messages to a Host without HostAccess", async () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const stranger = relay.loginPlaceholder("stranger");
    const strangerIphone = relay.registerDevice(stranger.id, "Stranger iPhone", "iphone");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    const baseUrl = await startRelay(relay, servers);

    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${strangerIphone.id}&userId=${stranger.id}`,
    );
    await clientSocket.read();
    clientSocket.send({
      type: "client.toHost",
      hostId: host.id,
      payload: { type: "turn.start" },
    });

    expect(await clientSocket.read()).toEqual({
      type: "relay.error",
      code: "HOST_ACCESS_DENIED",
      message: "Host access denied",
    });
  });

  it("sends cached Host events after client subscription", async () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const iphone = relay.registerDevice(owner.id, "Owner iPhone", "iphone");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    relay.appendHostEvent(host.id, { type: "host.offline", hostId: host.id });
    const baseUrl = await startRelay(relay, servers);

    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${iphone.id}&userId=${owner.id}`,
    );
    await clientSocket.read();
    clientSocket.send({
      type: "client.subscribeHost",
      hostId: host.id,
    });

    expect(await clientSocket.read()).toMatchObject({
      type: "host.event",
      event: {
        hostId: host.id,
        event: { type: "host.offline", hostId: host.id },
      },
    });
  });

  it("registers Host identity through bootstrap HTTP API", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: "secret",
    });
    const baseUrl = await startRelay(relay, servers);

    const response = await fetch(`${baseUrl.replace("ws://", "http://")}/api/host-bootstrap`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ownerDisplayName: "owner",
        hostName: "Owner MacBook",
        project: { id: "project_1", name: "Codex Link", path: "/repo" },
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      relayUrl: string;
      userId: string;
      deviceId: string;
      hostId: string;
      project: { id: string; name: string; path: string };
    };
    expect(body).toMatchObject({
      relayUrl: "http://relay.test",
      project: { id: "project_1", name: "Codex Link", path: "/repo" },
    });
    expect(relay.listHostsForUser(body.userId as never)).toMatchObject([
      { id: body.hostId, deviceId: body.deviceId, name: "Owner MacBook" },
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

interface TestRelaySocket {
  socket: WebSocket;
  send(message: unknown): void;
  read(): Promise<RelayServerMessage>;
}

function openRelaySocket(url: string): Promise<TestRelaySocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages: RelayServerMessage[] = [];
    const readers: Array<(message: RelayServerMessage) => void> = [];
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as RelayServerMessage;
      const reader = readers.shift();
      if (reader) {
        reader(message);
        return;
      }
      messages.push(message);
    });
    socket.once("open", () =>
      resolve({
        socket,
        send(message: unknown): void {
          socket.send(JSON.stringify(message));
        },
        read(): Promise<RelayServerMessage> {
          const message = messages.shift();
          if (message) {
            return Promise.resolve(message);
          }
          return new Promise((reader) => {
            readers.push(reader);
          });
        },
      }),
    );
    socket.once("error", reject);
  });
}
