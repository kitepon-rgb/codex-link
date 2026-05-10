#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function usage() {
  console.log(`Usage:
  node scripts/codex-app-server-smoke.mjs [options]

Options:
  --turn                 Also start a real Codex turn and wait for turn/completed.
  --steer-smoke          Start a turn, send turn/steer, and wait for turn/completed.
  --interrupt-smoke      Start a turn, send turn/interrupt, and wait for turn/completed.
  --approval-smoke       Trigger a small file-write approval in tmp/ and auto-accept it.
  --prompt <text>        Prompt for --turn mode.
  --cwd <path>           Thread cwd. Defaults to current working directory.
  --model <model>        Optional model override for thread/start.
  --timeout-ms <number>  Overall timeout. Defaults to 180000.
  --out <path>           Output JSONL log path. Defaults to tmp/codex-app-server-smoke/<timestamp>.jsonl.
  -h, --help             Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    turn: false,
    steerSmoke: false,
    interruptSmoke: false,
    approvalSmoke: false,
    prompt: "Reply with exactly: Codex Link smoke OK",
    cwd: root,
    model: null,
    timeoutMs: 180000,
    out: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      args.help = true;
    } else if (arg === "--turn") {
      args.turn = true;
    } else if (arg === "--steer-smoke") {
      args.steerSmoke = true;
      args.turn = true;
      args.prompt = [
        "Wait for an additional instruction from turn/steer before giving your final answer.",
        "Do not finish until that instruction arrives.",
      ].join(" ");
    } else if (arg === "--interrupt-smoke") {
      args.interruptSmoke = true;
      args.turn = true;
      args.prompt = [
        "Start a long answer by counting upward with one number per line.",
        "Keep going until interrupted.",
      ].join(" ");
    } else if (arg === "--approval-smoke") {
      args.approvalSmoke = true;
      args.turn = true;
      args.cwd = path.join(root, "tmp", "codex-app-server-approval-workdir");
      args.prompt = [
        "Create a file named approval-smoke.txt in the current directory.",
        "The file content must be exactly: Codex Link approval OK",
        "After creating it, reply with exactly: approval smoke completed",
      ].join(" ");
    } else if (arg === "--prompt") {
      args.prompt = requireValue(argv, ++index, arg);
    } else if (arg === "--cwd") {
      args.cwd = path.resolve(requireValue(argv, ++index, arg));
    } else if (arg === "--model") {
      args.model = requireValue(argv, ++index, arg);
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(requireValue(argv, ++index, arg));
      if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0) {
        throw new Error("--timeout-ms must be a positive integer");
      }
    } else if (arg === "--out") {
      args.out = path.resolve(requireValue(argv, ++index, arg));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.steerSmoke && args.interruptSmoke) {
    throw new Error("--steer-smoke and --interrupt-smoke cannot be combined");
  }

  return args;
}

function requireValue(argv, index, name) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function now() {
  return new Date().toISOString();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const outPath = args.out ?? path.join(
    root,
    "tmp",
    "codex-app-server-smoke",
    `${timestampForPath()}.jsonl`,
  );

  const transcript = [];
  const pending = new Map();
  const notifications = [];
  const serverRequests = [];
  const approvalRequests = [];
  let nextId = 1;
  let stdoutClosed = false;
  let processExited = false;
  let appServerExit = null;

  const proc = spawn("codex", ["app-server"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const timeout = setTimeout(() => {
    fail(new Error(`Timed out after ${args.timeoutMs}ms`));
  }, args.timeoutMs);

  function record(direction, payload) {
    transcript.push({
      ts: now(),
      direction,
      payload,
    });
  }

  function send(message) {
    record("client", message);
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function respond(id, result) {
    const message = { id, result };
    record("client", message);
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(method, params = {}) {
    const id = nextId;
    nextId += 1;
    send({ method, id, params });
    return new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
    });
  }

  function notify(method, params = {}) {
    send({ method, params });
  }

  function textInput(text) {
    return { type: "text", text, text_elements: [] };
  }

  async function finish(summary) {
    clearTimeout(timeout);
    proc.stdin.end();
    if (!processExited) {
      proc.kill("SIGTERM");
    }
    await writeTranscript(outPath, transcript);
    console.log(JSON.stringify({
      ok: true,
      out: path.relative(root, outPath),
      ...summary,
    }, null, 2));
  }

  async function fail(error) {
    clearTimeout(timeout);
    for (const pendingRequest of pending.values()) {
      pendingRequest.reject(error);
    }
    pending.clear();
    if (!processExited) {
      proc.kill("SIGTERM");
    }
    await writeTranscript(outPath, transcript);
    console.error(JSON.stringify({
      ok: false,
      out: path.relative(root, outPath),
      error: error.message,
    }, null, 2));
    process.exitCode = 1;
  }

  const rl = createInterface({ input: proc.stdout });
  rl.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      record("server-parse-error", { line, error: error.message });
      fail(new Error(`Could not parse app-server JSONL: ${error.message}`));
      return;
    }

    record("server", message);

    if (message && typeof message === "object" && "id" in message && message.method) {
      serverRequests.push(message);
      handleServerRequest(message);
      return;
    }

    if (typeof message.id === "number") {
      const pendingRequest = pending.get(message.id);
      if (!pendingRequest) {
        return;
      }

      pending.delete(message.id);
      if (message.error) {
        pendingRequest.reject(new Error(`${pendingRequest.method} failed: ${message.error.message}`));
      } else {
        pendingRequest.resolve(message.result);
      }
      return;
    }

    notifications.push(message);
  });

  proc.stderr.on("data", (chunk) => {
    record("server-stderr", chunk.toString("utf8"));
  });

  proc.on("exit", (code, signal) => {
    processExited = true;
    appServerExit = { code, signal };
    if (!stdoutClosed && code !== 0 && code !== null) {
      fail(new Error(`codex app-server exited early with code ${code}`));
    }
  });

  proc.stdout.on("close", () => {
    stdoutClosed = true;
  });

  try {
    if (args.approvalSmoke) {
      await mkdir(args.cwd, { recursive: true });
    }

    const initialize = await request("initialize", {
      clientInfo: {
        name: "codex_link_smoke",
        title: "Codex Link Smoke Test",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    notify("initialized");

    const account = await request("account/read", { refreshToken: false });
    const models = await request("model/list", { limit: 20, includeHidden: false });

    const threadParams = {
      cwd: args.cwd,
      serviceName: "codex_link_smoke",
    };
    if (args.model) {
      threadParams.model = args.model;
    }
    if (args.approvalSmoke) {
      threadParams.approvalPolicy = "on-request";
      threadParams.sandbox = "read-only";
    }

    const threadStart = await request("thread/start", threadParams);
    const threadId = threadStart?.thread?.id;
    if (!threadId) {
      throw new Error("thread/start response did not include thread.id");
    }

    let turnId = null;
    let turnStatus = null;
    let steerTurnId = null;
    let interrupted = false;
    let approvalSmokeFileContent = null;
    if (args.turn) {
      const turnStart = await request("turn/start", {
        threadId,
        input: [textInput(args.prompt)],
      });
      turnId = turnStart?.turn?.id ?? null;
      if (!turnId) {
        throw new Error("turn/start response did not include turn.id");
      }
      await waitForNotification("turn/started", (params) => {
        return params?.turn?.id === turnId;
      }, notifications, args.timeoutMs);
      if (args.steerSmoke) {
        const steer = await request("turn/steer", {
          threadId,
          expectedTurnId: turnId,
          input: [textInput("Now reply with exactly: Codex Link steer OK")],
        });
        steerTurnId = steer?.turnId ?? null;
      }
      if (args.interruptSmoke) {
        await request("turn/interrupt", { threadId, turnId });
        interrupted = true;
      }
      const completed = await waitForNotification("turn/completed", (params) => {
        return !turnId || params?.turn?.id === turnId;
      }, notifications, args.timeoutMs);
      turnStatus = completed?.turn?.status ?? null;
    }

    if (args.approvalSmoke) {
      const approvalSmokeFile = path.join(args.cwd, "approval-smoke.txt");
      approvalSmokeFileContent = (await readFile(approvalSmokeFile, "utf8")).trim();
      if (approvalSmokeFileContent !== "Codex Link approval OK") {
        throw new Error(`Unexpected approval smoke file content: ${approvalSmokeFileContent}`);
      }
      if (approvalRequests.length === 0) {
        throw new Error("Approval smoke completed without any approval request");
      }
    }

    await finish({
      appServerExit,
      initialized: Boolean(initialize),
      authMode: account?.account?.type ?? null,
      requiresOpenaiAuth: account?.requiresOpenaiAuth ?? null,
      modelCount: models?.data?.length ?? null,
      defaultModel: models?.data?.find((model) => model.isDefault)?.id ?? null,
      threadId,
      turnId,
      turnStatus,
      steerTurnId,
      interrupted,
      approvalSmokeFileContent,
      serverRequestMethods: [...new Set(serverRequests.map((message) => message.method).filter(Boolean))],
      approvalRequestCount: approvalRequests.length,
      notificationMethods: [...new Set(notifications.map((message) => message.method).filter(Boolean))],
    });
  } catch (error) {
    await fail(error);
  }

  function handleServerRequest(message) {
    if (message.method === "item/commandExecution/requestApproval") {
      approvalRequests.push(message);
      respond(message.id, { decision: "accept" });
      return;
    }

    if (message.method === "item/fileChange/requestApproval") {
      approvalRequests.push(message);
      respond(message.id, { decision: "accept" });
      return;
    }
  }
}

function waitForNotification(method, predicate, notifications, timeoutMs) {
  const existing = notifications.find((message) => {
    return message.method === method && predicate(message.params);
  });
  if (existing) {
    return Promise.resolve(existing.params);
  }

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const interval = setInterval(() => {
      const found = notifications.find((message) => {
        return message.method === method && predicate(message.params);
      });
      if (found) {
        clearInterval(interval);
        resolve(found.params);
        return;
      }

      if (Date.now() - started > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Timed out waiting for ${method}`));
      }
    }, 100);
  });
}

async function writeTranscript(outPath, transcript) {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    `${transcript.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
