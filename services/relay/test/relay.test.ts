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
