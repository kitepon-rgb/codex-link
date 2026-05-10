import { describe, expect, it, beforeEach } from "vitest";
import { RelayAuthzError, RelayService } from "../src/index.js";
import { resetIdsForTest } from "../src/id.js";

describe("RelayService", () => {
  beforeEach(() => {
    resetIdsForTest();
  });

  it("filters Host list by HostAccess", () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const other = relay.loginPlaceholder("other");
    const ownerDevice = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, ownerDevice.id, "Owner MacBook");

    expect(relay.listHostsForUser(owner.id)).toEqual([host]);
    expect(relay.listHostsForUser(other.id)).toEqual([]);

    relay.grantHostAccess(host.id, other.id, "viewer");

    expect(relay.listHostsForUser(other.id)).toEqual([host]);
  });

  it("rejects Host routes without HostAccess", () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const other = relay.loginPlaceholder("other");
    const ownerDevice = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, ownerDevice.id, "Owner MacBook");

    expect(() => relay.routeToHost(other.id, host.id, { type: "turn.start" })).toThrow(
      RelayAuthzError,
    );
    expect(relay.listAuditEvents()).toContainEqual(
      expect.objectContaining({
        action: "host.access.denied",
        outcome: "denied",
        userId: other.id,
        hostId: host.id,
      }),
    );
  });

  it("allows Host routes with HostAccess", () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const ownerDevice = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, ownerDevice.id, "Owner MacBook");

    expect(relay.routeToHost(owner.id, host.id, { type: "turn.start" })).toEqual({
      userId: owner.id,
      hostId: host.id,
      payload: { type: "turn.start" },
    });
  });

  it("allows Host owners to share and revoke non-owner HostAccess", () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const teammate = relay.loginPlaceholder("teammate");
    const ownerDevice = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, ownerDevice.id, "Owner MacBook");

    const grant = relay.grantHostAccessByOwner({
      ownerUserId: owner.id,
      hostId: host.id,
      targetUserId: teammate.id,
      role: "viewer",
    });

    expect(grant.access).toEqual({
      hostId: host.id,
      userId: teammate.id,
      role: "viewer",
    });
    expect(relay.listHostsForUser(teammate.id)).toEqual([host]);
    expect(relay.listAuditEvents()).toContainEqual(
      expect.objectContaining({
        action: "host.access.shared",
        outcome: "success",
        userId: owner.id,
        hostId: host.id,
        detail: { targetUserId: teammate.id, role: "viewer" },
      }),
    );

    const revocation = relay.revokeHostAccessByOwner({
      ownerUserId: owner.id,
      hostId: host.id,
      targetUserId: teammate.id,
    });

    expect(revocation.revokedAccess.role).toBe("viewer");
    expect(relay.listHostsForUser(teammate.id)).toEqual([]);
    expect(() => relay.routeToHost(teammate.id, host.id, { type: "turn.start" })).toThrow(
      RelayAuthzError,
    );
    expect(relay.listAuditEvents()).toContainEqual(
      expect.objectContaining({
        action: "host.access.revoked",
        outcome: "success",
        userId: owner.id,
        hostId: host.id,
        detail: { targetUserId: teammate.id, role: "viewer" },
      }),
    );
  });

  it("rejects HostAccess sharing from non-owners and owner revocation", () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const operator = relay.loginPlaceholder("operator");
    const teammate = relay.loginPlaceholder("teammate");
    const ownerDevice = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, ownerDevice.id, "Owner MacBook");
    relay.grantHostAccessByOwner({
      ownerUserId: owner.id,
      hostId: host.id,
      targetUserId: operator.id,
      role: "operator",
    });

    expect(() =>
      relay.grantHostAccessByOwner({
        ownerUserId: operator.id,
        hostId: host.id,
        targetUserId: teammate.id,
        role: "viewer",
      }),
    ).toThrow("Host owner access is required");
    expect(() =>
      relay.revokeHostAccessByOwner({
        ownerUserId: owner.id,
        hostId: host.id,
        targetUserId: owner.id,
      }),
    ).toThrow("Host owner access cannot be revoked");
    expect(relay.listHostsForUser(owner.id)).toEqual([host]);
    expect(relay.listAuditEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "host.access.grant.denied",
          outcome: "denied",
          userId: operator.id,
          hostId: host.id,
          detail: { role: "operator" },
        }),
        expect.objectContaining({
          action: "host.access.revoke.denied",
          outcome: "denied",
          userId: owner.id,
          hostId: host.id,
          detail: { targetUserId: owner.id, reason: "owner_access" },
        }),
      ]),
    );
  });

  it("grants HostAccess by redeeming a one-time Host pairing code", () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const guest = relay.loginPlaceholder("guest");
    const ownerDevice = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const guestIphone = relay.registerDevice(guest.id, "Guest iPhone", "iphone");
    const host = relay.registerHost(owner.id, ownerDevice.id, "Owner MacBook");
    const pairingCode = relay.createHostPairingCode(host.id, {
      now: new Date("2026-05-10T00:00:00Z"),
      ttlMs: 60_000,
    });

    const grant = relay.redeemHostPairingCode({
      userId: guest.id,
      deviceId: guestIphone.id,
      pairingCode: pairingCode.code.toLowerCase(),
      now: new Date("2026-05-10T00:00:10Z"),
    });

    expect(grant).toMatchObject({
      user: { id: guest.id },
      device: { id: guestIphone.id },
      host: { id: host.id },
      access: { hostId: host.id, userId: guest.id, role: "operator" },
    });
    expect(relay.listHostsForUser(guest.id)).toEqual([host]);
    expect(relay.listAuditEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "host.pairing_code.created",
          outcome: "success",
          hostId: host.id,
        }),
        expect.objectContaining({
          action: "host.access.granted",
          outcome: "success",
          userId: guest.id,
          hostId: host.id,
          detail: { role: "operator" },
        }),
        expect.objectContaining({
          action: "host.pairing_code.redeemed",
          outcome: "success",
          userId: guest.id,
          deviceId: guestIphone.id,
          hostId: host.id,
        }),
      ]),
    );
    const createdAudit = relay
      .listAuditEvents()
      .find((event) => event.action === "host.pairing_code.created");
    expect(createdAudit?.detail).toEqual({ expiresAt: pairingCode.expiresAt });
    expect(JSON.stringify(createdAudit)).not.toContain(pairingCode.code);
    expect(() =>
      relay.redeemHostPairingCode({
        userId: guest.id,
        deviceId: guestIphone.id,
        pairingCode: pairingCode.code,
      }),
    ).toThrow("already been used");
  });

  it("rejects expired Host pairing codes", () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const guest = relay.loginPlaceholder("guest");
    const ownerDevice = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const guestIphone = relay.registerDevice(guest.id, "Guest iPhone", "iphone");
    const host = relay.registerHost(owner.id, ownerDevice.id, "Owner MacBook");
    const pairingCode = relay.createHostPairingCode(host.id, {
      now: new Date("2026-05-10T00:00:00Z"),
      ttlMs: 60_000,
    });

    expect(() =>
      relay.redeemHostPairingCode({
        userId: guest.id,
        deviceId: guestIphone.id,
        pairingCode: pairingCode.code,
        now: new Date("2026-05-10T00:02:00Z"),
      }),
    ).toThrow("expired");
    expect(relay.listHostsForUser(guest.id)).toEqual([]);
  });

  it("revokes devices and rejects later Relay use", () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const iphone = relay.registerDevice(owner.id, "Owner iPhone", "iphone");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");
    const pairingCode = relay.createHostPairingCode(host.id, {
      now: new Date("2026-05-10T00:00:00Z"),
      ttlMs: 60_000,
    });

    const revocation = relay.revokeDevice({
      userId: owner.id,
      deviceId: iphone.id,
      now: new Date("2026-05-10T00:00:10Z"),
    });

    expect(revocation.device.revokedAt).toBe("2026-05-10T00:00:10.000Z");
    expect(relay.listAuditEvents()).toContainEqual(
      expect.objectContaining({
        action: "device.revoked",
        outcome: "success",
        userId: owner.id,
        deviceId: iphone.id,
        detail: {
          kind: "iphone",
          revokedAt: "2026-05-10T00:00:10.000Z",
        },
      }),
    );
    expect(() => relay.connectClientDevice(owner.id, iphone.id)).toThrow("Revoked device");
    expect(() =>
      relay.redeemHostPairingCode({
        userId: owner.id,
        deviceId: iphone.id,
        pairingCode: pairingCode.code,
      }),
    ).toThrow("Revoked device");
  });

  it("does not allow a user to revoke another user's device", () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const stranger = relay.loginPlaceholder("stranger");
    const iphone = relay.registerDevice(owner.id, "Owner iPhone", "iphone");

    expect(() =>
      relay.revokeDevice({
        userId: stranger.id,
        deviceId: iphone.id,
      }),
    ).toThrow(RelayAuthzError);
    expect(iphone.revokedAt).toBeNull();
    expect(relay.listAuditEvents()).toContainEqual(
      expect.objectContaining({
        action: "device.revocation.denied",
        outcome: "denied",
        userId: stranger.id,
        deviceId: iphone.id,
      }),
    );
  });

  it("marks Hosts offline when their Host device is revoked", () => {
    const relay = new RelayService();
    const owner = relay.loginPlaceholder("owner");
    const mac = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, mac.id, "Owner MacBook");

    relay.markHostOnline(host.id);
    relay.revokeDevice({
      userId: owner.id,
      deviceId: mac.id,
      now: new Date("2026-05-10T00:00:10Z"),
    });

    expect(relay.listHostsForUser(owner.id)[0]?.status).toBe("offline");
    expect(() => relay.connectDevice(mac.id, host.id)).toThrow("Revoked device");
  });

  it("keeps a bounded event cache per Host", () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 2,
      hostBootstrapToken: null,
    });
    const owner = relay.loginPlaceholder("owner");
    const ownerDevice = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, ownerDevice.id, "Owner MacBook");

    relay.appendHostEvent(host.id, { type: "host.online", host });
    relay.appendHostEvent(host.id, { type: "host.offline", hostId: host.id });
    relay.appendHostEvent(host.id, { type: "host.online", host });

    expect(relay.readHostEvents(owner.id, host.id).map((event) => event.sequence)).toEqual([
      2, 3,
    ]);
  });

  it("rejects replay when the requested sequence has fallen out of the Host event cache", () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 2,
      hostBootstrapToken: null,
    });
    const owner = relay.loginPlaceholder("owner");
    const ownerDevice = relay.registerDevice(owner.id, "Owner Mac", "mac-host");
    const host = relay.registerHost(owner.id, ownerDevice.id, "Owner MacBook");

    const first = relay.appendHostEvent(host.id, { type: "host.online", host });
    relay.appendHostEvent(host.id, { type: "host.offline", hostId: host.id });
    relay.appendHostEvent(host.id, { type: "host.online", host });
    relay.appendHostEvent(host.id, { type: "host.offline", hostId: host.id });

    expect(() => relay.readHostEventReplay(owner.id, host.id, first.sequence)).toThrow(
      "cannot replay after sequence",
    );
  });

  it("does not treat other Hosts' global sequence numbers as a replay gap", () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 1,
      hostBootstrapToken: null,
    });
    const owner = relay.loginPlaceholder("owner");
    const firstDevice = relay.registerDevice(owner.id, "First Mac", "mac-host");
    const secondDevice = relay.registerDevice(owner.id, "Second Mac", "mac-host");
    const firstHost = relay.registerHost(owner.id, firstDevice.id, "First MacBook");
    const secondHost = relay.registerHost(owner.id, secondDevice.id, "Second MacBook");

    const firstHostEvent = relay.appendHostEvent(firstHost.id, {
      type: "host.online",
      host: firstHost,
    });
    relay.appendHostEvent(secondHost.id, { type: "host.online", host: secondHost });
    relay.appendHostEvent(secondHost.id, { type: "host.offline", hostId: secondHost.id });
    const nextFirstHostEvent = relay.appendHostEvent(firstHost.id, {
      type: "host.offline",
      hostId: firstHost.id,
    });

    expect(
      relay.readHostEventReplay(owner.id, firstHost.id, firstHostEvent.sequence),
    ).toEqual({
      events: [nextFirstHostEvent],
      latestSequence: nextFirstHostEvent.sequence,
    });
  });

  it("registers a Host through bootstrap token", () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: "secret",
    });

    const registration = relay.registerHostBootstrap({
      token: "secret",
      ownerDisplayName: "owner",
      hostName: "Owner MacBook",
    });

    expect(registration.user.displayName).toBe("owner");
    expect(registration.device.kind).toBe("mac-host");
    expect(registration.host.deviceId).toBe(registration.device.id);
    expect(relay.listHostsForUser(registration.user.id)).toEqual([registration.host]);
  });

  it("rejects Host bootstrap with the wrong token", () => {
    const relay = new RelayService(undefined, {
      publicBaseUrl: "http://relay.test",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: "secret",
    });

    expect(() =>
      relay.registerHostBootstrap({
        token: "wrong",
        ownerDisplayName: "owner",
        hostName: "Owner MacBook",
      }),
    ).toThrow(RelayAuthzError);
  });
});
