import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodexAppServerClient } from "@codex-link/codex-client";
import type { MacHostConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export interface MacHostCapabilities {
  platform: "macos";
  codexCommandAvailable: boolean;
  codexVersion: string | null;
  projects: Array<{
    id: string;
    name: string;
    path: string;
    readable: boolean;
  }>;
}

export interface CodexAppServerCapabilities {
  models: unknown;
  experimentalFeatures: unknown;
  config: unknown;
}

export async function readMacHostCapabilities(
  config: MacHostConfig,
): Promise<MacHostCapabilities> {
  const codex = await readCodexVersion();
  return {
    platform: "macos",
    codexCommandAvailable: codex.available,
    codexVersion: codex.version,
    projects: await Promise.all(
      config.projects.map(async (project) => ({
        id: project.id,
        name: project.name,
        path: project.path,
        readable: await canRead(project.path),
      })),
    ),
  };
}

export async function readCodexAppServerCapabilities(
  codex: CodexAppServerClient,
  config: MacHostConfig,
): Promise<CodexAppServerCapabilities> {
  const cwd = config.projects[0]?.path ?? null;
  const [models, experimentalFeatures, codexConfig] = await Promise.all([
    codex.listModels({ includeHidden: true }),
    codex.listExperimentalFeatures({}),
    codex.readConfig({ includeLayers: true, cwd }),
  ]);
  return {
    models,
    experimentalFeatures,
    config: codexConfig,
  };
}

async function readCodexVersion(): Promise<{ available: boolean; version: string | null }> {
  try {
    const { stdout } = await execFileAsync("codex", ["--version"]);
    return { available: true, version: stdout.trim() || null };
  } catch {
    return { available: false, version: null };
  }
}

async function canRead(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
