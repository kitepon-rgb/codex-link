import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createRelayHttpServer, RelayService } from "@codex-link/relay";
import { MacHostRelayClient, type MacHostConfig } from "../src/index.js";

describe("MacHostRelayClient", () => {
  const servers: Array<ReturnType<typeof createRelayHttpServer>> = [];

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

  it("connects to Relay as Host and announces projects", async () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const iphone = relay.registerDevice(owner.id, "Owner iPhone", "iphone");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    const iphoneToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: iphone.id }).token;
    const macToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: mac.id }).token;
    const relayUrl = await startRelay(relay, servers);
    const clientSocket = await openRelaySocket(
      `${relayUrl}/relay?kind=client&deviceId=${iphone.id}&userId=${owner.id}`,
      iphoneToken,
    );
    await clientSocket.read();
    clientSocket.send({ type: "client.subscribeHost", hostId: host.id });

    const hostClient = new MacHostRelayClient({
      config: {
        relayUrl,
        userId: owner.id,
        deviceId: mac.id,
        deviceToken: macToken,
        hostId: host.id,
        hostName: "Owner MacBook",
        projects: [{ id: "project_1" as never, name: "Codex Link", path: process.cwd() }],
      } satisfies MacHostConfig,
    });

    await hostClient.connect();
    await hostClient.announce();

    await readUntilEvent(clientSocket, "host.online");
    const projectEvent = await readUntilEvent(clientSocket, "project.list.updated");
    expect(projectEvent).toMatchObject({
      type: "host.event",
      event: {
        event: {
          type: "project.list.updated",
          projects: [{ name: "Codex Link", pathLabel: process.cwd() }],
        },
      },
    });

    hostClient.close();
  });

  it("requests a one-time pairing code from Relay", async () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    const macToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: mac.id }).token;
    const relayUrl = await startRelay(relay, servers);
    const hostClient = new MacHostRelayClient({
      config: {
        relayUrl,
        userId: owner.id,
        deviceId: mac.id,
        deviceToken: macToken,
        hostId: host.id,
        hostName: "Owner MacBook",
        projects: [{ id: "project_1" as never, name: "Codex Link", path: process.cwd() }],
      } satisfies MacHostConfig,
    });

    await hostClient.connect();
    const pairingCode = await hostClient.createPairingCode();

    expect(pairingCode).toMatchObject({
      hostId: host.id,
    });
    expect(pairingCode.code).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);

    hostClient.close();
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
  send(message: unknown): void;
  read(): Promise<unknown>;
}

async function readUntilEvent(
  socket: TestRelaySocket,
  eventType: string,
): Promise<unknown> {
  for (let index = 0; index < 10; index += 1) {
    const message = await socket.read();
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "host.event" &&
      "event" in message
    ) {
      const cached = message.event as { event?: { type?: string } };
      if (cached.event?.type === eventType) {
        return message;
      }
    }
  }
  throw new Error(`Timed out waiting for event: ${eventType}`);
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
      }),
    );
    socket.once("error", reject);
  });
}
