#!/usr/bin/env node

// Probe whether codex app-server's thread/list returns appServer-source threads
// when called with the default sourceKinds filter (omitted) versus an explicit
// list. Used to verify whether iPhone-driven (= appServer source) threads will
// be visible to VSCode Codex extension or codex CLI default thread pickers.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

const cwd = process.argv[2] ?? process.cwd();
const limit = 200;
const timeoutMs = 60000;

const proc = spawn("codex", ["app-server"], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map();
let nextId = 1;
let exited = false;

const timeout = setTimeout(() => fail(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);

function send(message) {
  proc.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params = {}) {
  const id = nextId++;
  send({ method, id, params });
  return new Promise((resolve, reject) => {
    pending.set(id, { method, resolve, reject });
  });
}

function notify(method, params = {}) {
  send({ method, params });
}

createInterface({ input: proc.stdout }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message && typeof message.id === "number" && !message.method) {
    const pendingRequest = pending.get(message.id);
    if (!pendingRequest) return;
    pending.delete(message.id);
    if (message.error) {
      pendingRequest.reject(new Error(`${pendingRequest.method} failed: ${message.error.message}`));
    } else {
      pendingRequest.resolve(message.result);
    }
  }
});

proc.on("exit", (code) => {
  exited = true;
  if (code !== 0 && code !== null && pending.size > 0) {
    fail(new Error(`codex app-server exited with code ${code}`));
  }
});

function fail(error) {
  clearTimeout(timeout);
  if (!exited) proc.kill("SIGTERM");
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}

function summarize(label, response) {
  const data = Array.isArray(response?.data) ? response.data : [];
  const sourceCounts = {};
  for (const thread of data) {
    const source = typeof thread?.source === "string"
      ? thread.source
      : (thread?.source && typeof thread.source === "object" ? Object.keys(thread.source)[0] : "unknown");
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
  }
  return { label, total: data.length, sourceCounts };
}

try {
  await request("initialize", {
    clientInfo: { name: "codex_link_thread_source_probe", title: "Codex Link Thread Source Probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  notify("initialized", {});

  const defaultList = await request("thread/list", { limit, cwd });
  const allKindsList = await request("thread/list", {
    limit,
    cwd,
    sourceKinds: ["cli", "vscode", "exec", "appServer"],
  });
  const appServerOnly = await request("thread/list", { limit, cwd, sourceKinds: ["appServer"] });

  clearTimeout(timeout);
  if (!exited) {
    proc.stdin.end();
    proc.kill("SIGTERM");
  }

  console.log(JSON.stringify({
    ok: true,
    cwd,
    queries: [
      summarize("default (sourceKinds omitted)", defaultList),
      summarize("explicit cli/vscode/exec/appServer", allKindsList),
      summarize("appServer only", appServerOnly),
    ],
  }, null, 2));
} catch (error) {
  fail(error instanceof Error ? error : new Error(String(error)));
}
