export interface RelayConfig {
  publicBaseUrl: string;
  eventCacheLimitPerHost: number;
  hostBootstrapToken: string | null;
}

export function loadRelayConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  return {
    publicBaseUrl: env.CODEX_LINK_RELAY_URL ?? "http://localhost:3000",
    eventCacheLimitPerHost: Number.parseInt(
      env.CODEX_LINK_EVENT_CACHE_LIMIT ?? "200",
      10,
    ),
    hostBootstrapToken: env.CODEX_LINK_HOST_BOOTSTRAP_TOKEN ?? null,
  };
}
