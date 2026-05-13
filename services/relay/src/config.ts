export interface RelayConfig {
  publicBaseUrl: string;
  eventCacheLimitPerHost: number;
  hostBootstrapToken: string | null;
  rateLimitWindowMs?: number;
  rateLimitMaxRequestsPerWindow?: number;
  auditEventLimit?: number;
  maxHttpBodyBytes?: number;
  maxWebSocketPayloadBytes?: number;
  deviceCredentialTtlMs?: number;
  statePath?: string | null;
  stateFlushIntervalMs?: number;
}

export function loadRelayConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    publicBaseUrl: env.CODEX_LINK_RELAY_URL ?? "http://localhost:3000",
    eventCacheLimitPerHost: parseIntegerEnv(env, "CODEX_LINK_EVENT_CACHE_LIMIT", 200, 0),
    hostBootstrapToken: env.CODEX_LINK_HOST_BOOTSTRAP_TOKEN ?? null,
    rateLimitWindowMs: parseIntegerEnv(env, "CODEX_LINK_RATE_LIMIT_WINDOW_MS", 60_000, 1),
    rateLimitMaxRequestsPerWindow: parseIntegerEnv(
      env,
      "CODEX_LINK_RATE_LIMIT_MAX_REQUESTS",
      120,
      1,
    ),
    auditEventLimit: parseIntegerEnv(env, "CODEX_LINK_AUDIT_EVENT_LIMIT", 1000, 0),
    maxHttpBodyBytes: parseIntegerEnv(env, "CODEX_LINK_MAX_HTTP_BODY_BYTES", 65_536, 1),
    maxWebSocketPayloadBytes: parseIntegerEnv(
      env,
      "CODEX_LINK_MAX_WEBSOCKET_PAYLOAD_BYTES",
      1_048_576,
      1,
    ),
    deviceCredentialTtlMs: parseIntegerEnv(
      env,
      "CODEX_LINK_DEVICE_CREDENTIAL_TTL_MS",
      30 * 24 * 60 * 60 * 1000,
      60_000,
    ),
    statePath: env.CODEX_LINK_RELAY_STATE_PATH ?? null,
    stateFlushIntervalMs: parseIntegerEnv(
      env,
      "CODEX_LINK_RELAY_STATE_FLUSH_INTERVAL_MS",
      2_000,
      100,
    ),
  };
}

function parseIntegerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  minValue: number,
): number {
  const raw = env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minValue) {
    throw new Error(`${name} must be an integer greater than or equal to ${minValue}`);
  }
  return parsed;
}
