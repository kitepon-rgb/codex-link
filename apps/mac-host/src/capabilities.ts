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
  models: {
    data: Array<{
      id: string;
      displayName: string | null;
      description: string | null;
      hidden: boolean | null;
      isDefault: boolean | null;
      defaultReasoningEffort: string | null;
    }>;
    nextCursor: string | null;
  };
  experimentalFeatures: {
    data: Array<{
      name: string;
      stage: string | null;
      displayName: string | null;
      enabled: boolean | null;
      defaultEnabled: boolean | null;
    }>;
  };
  config: {
    model: string | null;
    modelReasoningEffort: string | null;
    approvalPolicy: string | null;
    sandboxMode: string | null;
    features: Record<string, boolean>;
    projectTrustLevel: string | null;
  };
  account: CodexAppServerAccountSummary;
}

export interface CodexAppServerAccountSummary {
  authMode: "chatgpt" | "apiKey" | "amazonBedrock" | null;
  chatgpt: {
    email: string;
    planType: string | null;
  } | null;
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
  const [models, experimentalFeatures, codexConfig, account] = await Promise.all([
    codex.listModels({ includeHidden: true }),
    codex.listExperimentalFeatures({}),
    codex.readConfig({ includeLayers: true, cwd }),
    readCodexAccount(codex),
  ]);
  return {
    models: summarizeModels(models),
    experimentalFeatures: summarizeExperimentalFeatures(experimentalFeatures),
    config: summarizeConfig(codexConfig, cwd),
    account,
  };
}

export async function readCodexAccount(
  codex: CodexAppServerClient,
): Promise<CodexAppServerAccountSummary> {
  let response: unknown = null;
  try {
    response = await codex.request("account/read", { refreshToken: false });
  } catch {
    return { authMode: null, chatgpt: null };
  }
  const account = objectValue(objectValue(response)?.account);
  const type = stringValue(account?.type);
  if (type === "chatgpt") {
    const email = stringValue(account?.email);
    if (!email) {
      return { authMode: "chatgpt", chatgpt: null };
    }
    const planType = stringValue(account?.planType) ?? stringValue(account?.plan_type);
    return {
      authMode: "chatgpt",
      chatgpt: { email, planType },
    };
  }
  if (type === "apiKey" || type === "amazonBedrock") {
    return { authMode: type, chatgpt: null };
  }
  return { authMode: null, chatgpt: null };
}

function summarizeModels(value: unknown): CodexAppServerCapabilities["models"] {
  const object = objectValue(value);
  return {
    data: arrayValue(object?.data).flatMap((item) => {
      const model = objectValue(item);
      const id = stringValue(model?.id);
      if (!id) {
        return [];
      }
      return [
        {
          id,
          displayName: stringValue(model?.displayName),
          description: stringValue(model?.description),
          hidden: booleanValue(model?.hidden),
          isDefault: booleanValue(model?.isDefault),
          defaultReasoningEffort: stringValue(model?.defaultReasoningEffort),
        },
      ];
    }),
    nextCursor: stringValue(object?.nextCursor),
  };
}

function summarizeExperimentalFeatures(
  value: unknown,
): CodexAppServerCapabilities["experimentalFeatures"] {
  const object = objectValue(value);
  return {
    data: arrayValue(object?.data).flatMap((item) => {
      const feature = objectValue(item);
      const name = stringValue(feature?.name);
      if (!name) {
        return [];
      }
      return [
        {
          name,
          stage: stringValue(feature?.stage),
          displayName: stringValue(feature?.displayName),
          enabled: booleanValue(feature?.enabled),
          defaultEnabled: booleanValue(feature?.defaultEnabled),
        },
      ];
    }),
  };
}

function summarizeConfig(
  value: unknown,
  cwd: string | null,
): CodexAppServerCapabilities["config"] {
  const root = objectValue(value);
  const config = objectValue(root?.config) ?? root ?? {};
  const features = objectValue(config?.features);
  return {
    model: stringValue(config?.model),
    modelReasoningEffort: stringValue(config?.model_reasoning_effort),
    approvalPolicy: stringValue(config?.approval_policy),
    sandboxMode: stringValue(config?.sandbox_mode),
    features: booleanRecord(features),
    projectTrustLevel: projectTrustLevel(config, cwd),
  };
}

function projectTrustLevel(config: Record<string, unknown>, cwd: string | null): string | null {
  if (!cwd) {
    return null;
  }
  const projects = objectValue(config.projects);
  const project = objectValue(projects?.[cwd]);
  return stringValue(project?.trust_level);
}

function booleanRecord(value: Record<string, unknown> | null): Record<string, boolean> {
  if (!value) {
    return {};
  }
  const result: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "boolean") {
      result[key] = item;
    }
  }
  return result;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
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
