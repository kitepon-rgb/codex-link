export interface RelayConfig {
  publicBaseUrl: string;
  eventCacheLimitPerHost: number;
  hostBootstrapToken: string | null;
  rateLimitWindowMs?: number;
  rateLimitMaxRequestsPerWindow?: number;
  auditEventLimit?: number;
  maxHttpBodyBytes?: number;
}

export function loadRelayConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    publicBaseUrl: env.CODEX_LINK_RELAY_URL ?? "http://localhost:3000",
    eventCacheLimitPerHost: Number.parseInt(
      env.CODEX_LINK_EVENT_CACHE_LIMIT ?? "200",
      10,
    ),
    hostBootstrapToken: env.CODEX_LINK_HOST_BOOTSTRAP_TOKEN ?? null,
    rateLimitWindowMs: Number.parseInt(
      env.CODEX_LINK_RATE_LIMIT_WINDOW_MS ?? "60000",
      10,
    ),
    rateLimitMaxRequestsPerWindow: Number.parseInt(
      env.CODEX_LINK_RATE_LIMIT_MAX_REQUESTS ?? "120",
      10,
    ),
    auditEventLimit: Number.parseInt(env.CODEX_LINK_AUDIT_EVENT_LIMIT ?? "1000", 10),
    maxHttpBodyBytes: Number.parseInt(
      env.CODEX_LINK_MAX_HTTP_BODY_BYTES ?? "65536",
      10,
    ),
  };
}
