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
    const iphoneToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: iphone.id }).token;
    const macToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: mac.id }).token;
    const baseUrl = await startRelay(relay, servers);

    const hostSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=host&deviceId=${mac.id}&hostId=${host.id}`,
      macToken,
    );
    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${iphone.id}&userId=${owner.id}`,
      iphoneToken,
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
    const strangerToken = relay.issueDeviceCredential({
      userId: stranger.id,
      deviceId: strangerIphone.id,
    }).token;
    const baseUrl = await startRelay(relay, servers);

    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${strangerIphone.id}&userId=${stranger.id}`,
      strangerToken,
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
    const iphoneToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: iphone.id }).token;
    relay.appendHostEvent(host.id, { type: "host.offline", hostId: host.id });
    const baseUrl = await startRelay(relay, servers);

    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${iphone.id}&userId=${owner.id}`,
      iphoneToken,
    );
    await clientSocket.read();
    clientSocket.send({
      type: "client.subscribeHost",
      hostId: host.id,
    });

    const event = await clientSocket.read();
    expect(event).toMatchObject({
      type: "host.event",
      event: {
        hostId: host.id,
        event: { type: "host.offline", hostId: host.id },
      },
    });
    expect(await clientSocket.read()).toEqual({
      type: "host.subscription.ready",
      hostId: host.id,
      afterSequence: 0,
      latestSequence: event.type === "host.event" ? event.event.sequence : 0,
    });
  });

  it("replays only events after the requested sequence and marks subscription readiness", async () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const iphone = relay.registerDevice(owner.id, "Owner iPhone", "iphone");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    const iphoneToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: iphone.id }).token;
    const first = relay.appendHostEvent(host.id, { type: "host.offline", hostId: host.id });
    const second = relay.appendHostEvent(host.id, {
      type: "project.list.updated",
      hostId: host.id,
      projects: [],
    });
    const baseUrl = await startRelay(relay, servers);

    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${iphone.id}&userId=${owner.id}`,
      iphoneToken,
    );
    await clientSocket.read();
    clientSocket.send({
      type: "client.subscribeHost",
      hostId: host.id,
      afterSequence: first.sequence,
    });

    expect(await clientSocket.read()).toMatchObject({
      type: "host.event",
      event: {
        sequence: second.sequence,
        hostId: host.id,
      },
    });
    expect(await clientSocket.read()).toEqual({
      type: "host.subscription.ready",
      hostId: host.id,
      afterSequence: first.sequence,
      latestSequence: second.sequence,
    });
  });

  it("reports an explicit cache gap instead of accepting a lossy Host subscription", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 2,
      hostBootstrapToken: null,
    });
    const owner = relay.loginPlaceholder("owner");
    const iphone = relay.registerDevice(owner.id, "Owner iPhone", "iphone");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    const iphoneToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: iphone.id }).token;
    const first = relay.appendHostEvent(host.id, { type: "host.online", host });
    relay.appendHostEvent(host.id, { type: "host.offline", hostId: host.id });
    relay.appendHostEvent(host.id, {
      type: "project.list.updated",
      hostId: host.id,
      projects: [],
    });
    relay.appendHostEvent(host.id, { type: "host.offline", hostId: host.id });
    const baseUrl = await startRelay(relay, servers);

    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${iphone.id}&userId=${owner.id}`,
      iphoneToken,
    );
    await clientSocket.read();
    clientSocket.send({
      type: "client.subscribeHost",
      hostId: host.id,
      afterSequence: first.sequence,
    });

    expect(await clientSocket.read()).toMatchObject({
      type: "relay.error",
      code: "HOST_EVENT_CACHE_GAP",
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
      deviceToken: string;
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

  it("registers placeholder iPhone device sessions through HTTP API", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: null,
    });
    const baseUrl = await startRelay(relay, servers);

    const response = await fetch(`${baseUrl.replace("ws://", "http://")}/api/device-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "owner",
        deviceName: "Owner iPhone",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      relayUrl: string;
      userId: string;
      deviceId: string;
      deviceToken: string;
      displayName: string;
      deviceName: string;
    };
    expect(body).toMatchObject({
      relayUrl: "http://relay.test",
      displayName: "owner",
      deviceName: "Owner iPhone",
    });

    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${body.deviceId}&userId=${body.userId}`,
      body.deviceToken,
    );
    expect(await clientSocket.read()).toMatchObject({
      type: "relay.ready",
      role: "client",
    });
  });

  it("serves a health check endpoint for container probes", async () => {
    const relay = new RelayService();
    const baseUrl = await startRelay(relay, servers);

    const response = await fetch(`${baseUrl.replace("ws://", "http://")}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("rate limits placeholder iPhone device session creation", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: null,
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequestsPerWindow: 1,
    });
    const baseUrl = await startRelay(relay, servers);
    const httpBaseUrl = baseUrl.replace("ws://", "http://");

    const first = await fetch(`${httpBaseUrl}/api/device-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "owner",
        deviceName: "Owner iPhone",
      }),
    });
    expect(first.status).toBe(201);

    const second = await fetch(`${httpBaseUrl}/api/device-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "owner",
        deviceName: "Second iPhone",
      }),
    });
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({
      code: "RATE_LIMITED",
      message: "Rate limit exceeded",
    });
  });

  it("rejects oversized HTTP JSON bodies", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: null,
      maxHttpBodyBytes: 8,
    });
    const baseUrl = await startRelay(relay, servers);
    const httpBaseUrl = baseUrl.replace("ws://", "http://");

    const response = await fetch(`${httpBaseUrl}/api/device-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "owner",
        deviceName: "Owner iPhone",
      }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: "HTTP request body too large",
    });
  });

  it("rate limits Host pairing code creation over WebSocket", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: null,
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequestsPerWindow: 1,
    });
    const owner = relay.loginPlaceholder("owner");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    const macToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: mac.id }).token;
    const baseUrl = await startRelay(relay, servers);

    const hostSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=host&deviceId=${mac.id}&hostId=${host.id}`,
      macToken,
    );
    await hostSocket.read();
    hostSocket.send({ type: "host.pairingCode.create" });
    expect(await hostSocket.read()).toMatchObject({
      type: "host.pairingCode.created",
      hostId: host.id,
    });

    hostSocket.send({ type: "host.pairingCode.create" });
    expect(await hostSocket.read()).toEqual({
      type: "relay.error",
      code: "RATE_LIMITED",
      message: "Rate limit exceeded",
    });
  });

  it("closes WebSocket connections that exceed the configured payload size", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: null,
      maxWebSocketPayloadBytes: 32,
    });
    const owner = relay.loginPlaceholder("owner");
    const iphone = relay.registerDevice(owner.id, "Owner iPhone", "iphone");
    const iphoneToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: iphone.id }).token;
    const baseUrl = await startRelay(relay, servers);

    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${iphone.id}&userId=${owner.id}`,
      iphoneToken,
    );
    await clientSocket.read();

    const closed = clientSocket.closed();
    clientSocket.socket.send(JSON.stringify({
      type: "client.toHost",
      hostId: "host_1",
      payload: { text: "payload larger than thirty-two bytes" },
    }));

    await expect(closed).resolves.toMatchObject({ code: 1009 });
  });

  it("revokes placeholder iPhone sessions and disconnects active Relay sockets", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: null,
    });
    const baseUrl = await startRelay(relay, servers);
    const httpBaseUrl = baseUrl.replace("ws://", "http://");

    const deviceResponse = await fetch(`${httpBaseUrl}/api/device-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "owner",
        deviceName: "Owner iPhone",
      }),
    });
    const device = (await deviceResponse.json()) as {
      userId: string;
      deviceId: string;
      deviceToken: string;
    };
    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${device.deviceId}&userId=${device.userId}`,
      device.deviceToken,
    );
    await clientSocket.read();

    const revokeResponse = await fetch(`${httpBaseUrl}/api/device-session/revoke`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${device.deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: device.userId,
        deviceId: device.deviceId,
      }),
    });

    expect(revokeResponse.status).toBe(200);
    await expect(revokeResponse.json()).resolves.toMatchObject({
      userId: device.userId,
      deviceId: device.deviceId,
    });
    expect(await clientSocket.read()).toEqual({
      type: "relay.error",
      code: "HOST_ACCESS_DENIED",
      message: "Revoked device cannot connect",
    });

    const rejectedSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${device.deviceId}&userId=${device.userId}`,
      device.deviceToken,
    );
    expect(await rejectedSocket.read()).toEqual({
      type: "relay.error",
      code: "HOST_ACCESS_DENIED",
      message: "Revoked device cannot connect",
    });
  });

  it("pairs a placeholder iPhone device session to a Host with a Host-generated code", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: null,
    });
    const owner = relay.loginPlaceholder("owner");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    const macToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: mac.id }).token;
    const baseUrl = await startRelay(relay, servers);

    const hostSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=host&deviceId=${mac.id}&hostId=${host.id}`,
      macToken,
    );
    await hostSocket.read();
    hostSocket.send({ type: "host.pairingCode.create" });
    const pairingMessage = await hostSocket.read();
    expect(pairingMessage).toMatchObject({
      type: "host.pairingCode.created",
      hostId: host.id,
    });
    if (pairingMessage.type !== "host.pairingCode.created") {
      throw new Error("Expected host.pairingCode.created");
    }

    const deviceResponse = await fetch(`${baseUrl.replace("ws://", "http://")}/api/device-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "owner",
        deviceName: "Owner iPhone",
      }),
    });
    const device = (await deviceResponse.json()) as {
      userId: string;
      deviceId: string;
      deviceToken: string;
    };

    const pairResponse = await fetch(`${baseUrl.replace("ws://", "http://")}/api/device-session/pair`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${device.deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: device.userId,
        deviceId: device.deviceId,
        pairingCode: pairingMessage.code,
      }),
    });

    expect(pairResponse.status).toBe(201);
    await expect(pairResponse.json()).resolves.toMatchObject({
      hostId: host.id,
      hostName: "Owner MacBook",
      role: "operator",
    });

    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${device.deviceId}&userId=${device.userId}`,
      device.deviceToken,
    );
    await clientSocket.read();
    clientSocket.send({ type: "client.subscribeHost", hostId: host.id });
    expect(await clientSocket.read()).toMatchObject({
      type: "host.event",
      event: {
        hostId: host.id,
        event: { type: "host.online" },
      },
    });
  });

  it("shares and revokes HostAccess through owner-checked HTTP APIs", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: null,
    });
    const owner = relay.loginPlaceholder("owner");
    const guest = relay.loginPlaceholder("guest");
    const guestIphone = relay.registerDevice(guest.id, "Guest iPhone", "iphone");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    const guestToken = relay.issueDeviceCredential({
      userId: guest.id,
      deviceId: guestIphone.id,
    }).token;
    const macToken = relay.issueDeviceCredential({ userId: owner.id, deviceId: mac.id }).token;
    const baseUrl = await startRelay(relay, servers);
    const httpBaseUrl = baseUrl.replace("ws://", "http://");

    const hostSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=host&deviceId=${mac.id}&hostId=${host.id}`,
      macToken,
    );
    await hostSocket.read();

    const grantResponse = await fetch(`${httpBaseUrl}/api/host-access/grant`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${macToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ownerUserId: owner.id,
        ownerDeviceId: mac.id,
        hostId: host.id,
        targetUserId: guest.id,
        role: "operator",
      }),
    });
    expect(grantResponse.status).toBe(201);
    await expect(grantResponse.json()).resolves.toMatchObject({
      hostId: host.id,
      userId: guest.id,
      role: "operator",
    });

    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${guestIphone.id}&userId=${guest.id}`,
      guestToken,
    );
    await clientSocket.read();
    clientSocket.send({
      type: "client.toHost",
      hostId: host.id,
      payload: { type: "turn.start", text: "shared" },
    });
    expect(await hostSocket.read()).toMatchObject({
      type: "host.message",
      message: {
        userId: guest.id,
        hostId: host.id,
        payload: { type: "turn.start", text: "shared" },
      },
    });

    const revokeResponse = await fetch(`${httpBaseUrl}/api/host-access/revoke`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${macToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ownerUserId: owner.id,
        ownerDeviceId: mac.id,
        hostId: host.id,
        targetUserId: guest.id,
      }),
    });
    expect(revokeResponse.status).toBe(200);
    await expect(revokeResponse.json()).resolves.toMatchObject({
      hostId: host.id,
      userId: guest.id,
      revokedRole: "operator",
    });

    clientSocket.send({
      type: "client.toHost",
      hostId: host.id,
      payload: { type: "turn.start", text: "denied" },
    });
    expect(await clientSocket.read()).toEqual({
      type: "relay.error",
      code: "HOST_ACCESS_DENIED",
      message: "Host access denied",
    });
  });

  it("allows viewer HostAccess to subscribe but not send Host commands", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: null,
    });
    const owner = relay.loginPlaceholder("owner");
    const viewer = relay.loginPlaceholder("viewer");
    const viewerIphone = relay.registerDevice(viewer.id, "Viewer iPhone", "iphone");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    const viewerToken = relay.issueDeviceCredential({
      userId: viewer.id,
      deviceId: viewerIphone.id,
    }).token;
    relay.grantHostAccess(host.id, viewer.id, "viewer");
    relay.appendHostEvent(host.id, { type: "host.online", host });
    const baseUrl = await startRelay(relay, servers);

    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${viewerIphone.id}&userId=${viewer.id}`,
      viewerToken,
    );
    await clientSocket.read();
    clientSocket.send({ type: "client.subscribeHost", hostId: host.id });
    expect(await clientSocket.read()).toMatchObject({
      type: "host.event",
      event: {
        hostId: host.id,
        event: { type: "host.online" },
      },
    });
    expect(await clientSocket.read()).toMatchObject({
      type: "host.subscription.ready",
      hostId: host.id,
    });

    clientSocket.send({
      type: "client.toHost",
      hostId: host.id,
      payload: { type: "turn.start", text: "viewer denied" },
    });
    expect(await clientSocket.read()).toEqual({
      type: "relay.error",
      code: "HOST_ACCESS_DENIED",
      message: "Host operator access is required",
    });
  });

  it("rejects WebSocket connections without a device credential", async () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const iphone = relay.registerDevice(owner.id, "Owner iPhone", "iphone");
    const baseUrl = await startRelay(relay, servers);

    const clientSocket = await openRelaySocket(
      `${baseUrl}/relay?kind=client&deviceId=${iphone.id}&userId=${owner.id}`,
    );

    expect(await clientSocket.read()).toEqual({
      type: "relay.error",
      code: "AUTHENTICATION_REQUIRED",
      message: "Device credential required",
    });
  });

  it("rejects protected device-session HTTP calls with invalid or missing credentials", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: null,
    });
    const baseUrl = await startRelay(relay, servers);
    const httpBaseUrl = baseUrl.replace("ws://", "http://");

    const deviceResponse = await fetch(`${httpBaseUrl}/api/device-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "owner",
        deviceName: "Owner iPhone",
      }),
    });
    const device = (await deviceResponse.json()) as { userId: string; deviceId: string };

    const pairResponse = await fetch(`${httpBaseUrl}/api/device-session/pair`, {
      method: "POST",
      headers: {
        authorization: "Bearer invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: device.userId,
        deviceId: device.deviceId,
        pairingCode: "ABCD-EF12",
      }),
    });
    expect(pairResponse.status).toBe(401);
    await expect(pairResponse.json()).resolves.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      message: "Invalid device credential",
    });

    const revokeResponse = await fetch(`${httpBaseUrl}/api/device-session/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: device.userId,
        deviceId: device.deviceId,
      }),
    });
    expect(revokeResponse.status).toBe(401);
    await expect(revokeResponse.json()).resolves.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      message: "Device credential required",
    });
  });

  it("rotates device credentials through the protected HTTP endpoint", async () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: null,
      deviceCredentialTtlMs: 60_000,
    });
    const baseUrl = await startRelay(relay, servers);
    const httpBaseUrl = baseUrl.replace("ws://", "http://");

    const deviceResponse = await fetch(`${httpBaseUrl}/api/device-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "owner",
        deviceName: "Owner iPhone",
      }),
    });
    const device = (await deviceResponse.json()) as {
      userId: string;
      deviceId: string;
      deviceToken: string;
      deviceTokenExpiresAt: string;
    };
    expect(device.deviceTokenExpiresAt).toMatch(/Z$/);

    const rotateResponse = await fetch(`${httpBaseUrl}/api/device-credential/rotate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${device.deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: device.userId,
        deviceId: device.deviceId,
      }),
    });
    expect(rotateResponse.status).toBe(200);
    const rotated = (await rotateResponse.json()) as {
      deviceToken: string;
      deviceTokenExpiresAt: string;
    };
    expect(rotated.deviceToken).not.toBe(device.deviceToken);
    expect(rotated.deviceTokenExpiresAt).toMatch(/Z$/);

    const oldTokenResponse = await fetch(`${httpBaseUrl}/api/device-session/revoke`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${device.deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: device.userId,
        deviceId: device.deviceId,
      }),
    });
    expect(oldTokenResponse.status).toBe(401);
    await expect(oldTokenResponse.json()).resolves.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      message: "Invalid device credential",
    });

    const newTokenResponse = await fetch(`${httpBaseUrl}/api/device-session/revoke`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${rotated.deviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: device.userId,
        deviceId: device.deviceId,
      }),
    });
    expect(newTokenResponse.status).toBe(200);
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
  closed(): Promise<{ code: number; reason: string }>;
}

function openRelaySocket(url: string, deviceToken?: string): Promise<TestRelaySocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      url,
      deviceToken
        ? {
            headers: { authorization: `Bearer ${deviceToken}` },
          }
        : undefined,
    );
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
        closed(): Promise<{ code: number; reason: string }> {
          return new Promise((closed) => {
            socket.once("close", (code, reason) => {
              closed({ code, reason: reason.toString("utf8") });
            });
          });
        },
      }),
    );
    socket.once("error", reject);
  });
}
