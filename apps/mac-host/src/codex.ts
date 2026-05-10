import {
  createCodexAppServerClient,
  type CodexAppServerClient,
  type CodexAppServerClientOptions,
} from "@codex-link/codex-client";
import type { MacHostConfig } from "./config.js";

export interface StartMacHostCodexAppServerOptions {
  config: MacHostConfig;
  clientOptions?: CodexAppServerClientOptions;
}

export async function startMacHostCodexAppServer({
  config,
  clientOptions = {},
}: StartMacHostCodexAppServerOptions): Promise<CodexAppServerClient> {
  const options: CodexAppServerClientOptions = {
    command: "codex",
    args: ["app-server"],
    ...clientOptions,
    clientInfo: clientOptions.clientInfo ?? {
      name: "codex_link_mac_host",
      title: "Codex Link Mac Host",
      version: "0.0.0",
    },
    experimentalApi: clientOptions.experimentalApi ?? true,
  };
  if (config.projects[0]?.path && !clientOptions.cwd) {
    options.cwd = config.projects[0].path;
  }
  const client = await createCodexAppServerClient(options);
  await client.initialize();
  return client;
}
