import { describe, expect, it } from "vitest";
import { loadRelayConfig } from "../src/index.js";

describe("loadRelayConfig", () => {
  it("loads default numeric limits", () => {
    expect(loadRelayConfig({})).toMatchObject({
      publicBaseUrl: "http://localhost:3000",
      eventCacheLimitPerHost: 200,
      hostBootstrapToken: null,
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequestsPerWindow: 120,
      auditEventLimit: 1000,
      maxHttpBodyBytes: 65_536,
      maxWebSocketPayloadBytes: 1_048_576,
    });
  });

  it("parses explicit integer limits", () => {
    expect(
      loadRelayConfig({
        CODEX_LINK_RELAY_URL: "https://relay.example.com",
        CODEX_LINK_EVENT_CACHE_LIMIT: "0",
        CODEX_LINK_HOST_BOOTSTRAP_TOKEN: "bootstrap-token",
        CODEX_LINK_RATE_LIMIT_WINDOW_MS: "5000",
        CODEX_LINK_RATE_LIMIT_MAX_REQUESTS: "7",
        CODEX_LINK_AUDIT_EVENT_LIMIT: "0",
        CODEX_LINK_MAX_HTTP_BODY_BYTES: "1024",
        CODEX_LINK_MAX_WEBSOCKET_PAYLOAD_BYTES: "2048",
      }),
    ).toMatchObject({
      publicBaseUrl: "https://relay.example.com",
      eventCacheLimitPerHost: 0,
      hostBootstrapToken: "bootstrap-token",
      rateLimitWindowMs: 5000,
      rateLimitMaxRequestsPerWindow: 7,
      auditEventLimit: 0,
      maxHttpBodyBytes: 1024,
      maxWebSocketPayloadBytes: 2048,
    });
  });

  it("rejects malformed numeric limits instead of silently falling back", () => {
    expect(() =>
      loadRelayConfig({
        CODEX_LINK_MAX_HTTP_BODY_BYTES: "abc",
      }),
    ).toThrow("CODEX_LINK_MAX_HTTP_BODY_BYTES must be an integer");
    expect(() =>
      loadRelayConfig({
        CODEX_LINK_RATE_LIMIT_MAX_REQUESTS: "0",
      }),
    ).toThrow("CODEX_LINK_RATE_LIMIT_MAX_REQUESTS must be an integer greater than or equal to 1");
    expect(() =>
      loadRelayConfig({
        CODEX_LINK_EVENT_CACHE_LIMIT: "-1",
      }),
    ).toThrow("CODEX_LINK_EVENT_CACHE_LIMIT must be an integer greater than or equal to 0");
  });
});
