#!/usr/bin/env bash
set -euo pipefail

CONFIG_DIR="${CODEX_LINK_CONFIG_DIR:-$HOME/.codex-link}"
CONFIG_FILE="$CONFIG_DIR/host.json"

required() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

required CODEX_LINK_RELAY_URL

HOST_NAME="${CODEX_LINK_HOST_NAME:-$(hostname)}"
OWNER_NAME="${CODEX_LINK_OWNER_NAME:-${USER:-owner}}"
PROJECT_PATH="${CODEX_LINK_PROJECT_PATH:-$PWD}"
PROJECT_NAME="${CODEX_LINK_PROJECT_NAME:-$(basename "$PROJECT_PATH")}"
PROJECT_ID="${CODEX_LINK_PROJECT_ID:-project-default}"
export HOST_NAME OWNER_NAME PROJECT_PATH PROJECT_NAME PROJECT_ID

if ! command -v node >/dev/null 2>&1; then
  echo "node command is not available on PATH" >&2
  exit 1
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "codex command is not available on PATH" >&2
  exit 1
fi

codex --version >/dev/null

mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

if [[ -n "${CODEX_LINK_HOST_BOOTSTRAP_TOKEN:-}" ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl command is not available on PATH" >&2
    exit 1
  fi

  BOOTSTRAP_URL="$(node -e '
    const url = new URL(process.env.CODEX_LINK_RELAY_URL);
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol === "wss:") url.protocol = "https:";
    url.pathname = `${url.pathname.replace(/\\/$/, "")}/api/host-bootstrap`;
    url.search = "";
    process.stdout.write(url.toString());
  ')"
  BOOTSTRAP_RESPONSE_FILE="$(mktemp)"
  trap 'rm -f "$BOOTSTRAP_RESPONSE_FILE"' EXIT
  node -e '
    process.stdout.write(JSON.stringify({
      ownerDisplayName: process.env.OWNER_NAME,
      hostName: process.env.HOST_NAME,
      project: {
        id: process.env.PROJECT_ID,
        name: process.env.PROJECT_NAME,
        path: process.env.PROJECT_PATH
      }
    }));
  ' | curl -fsS \
    -X POST "$BOOTSTRAP_URL" \
    -H "authorization: Bearer $CODEX_LINK_HOST_BOOTSTRAP_TOKEN" \
    -H "content-type: application/json" \
    --data-binary @- \
    -o "$BOOTSTRAP_RESPONSE_FILE"

  node - "$BOOTSTRAP_RESPONSE_FILE" "$CONFIG_FILE" <<'NODE'
const fs = require("node:fs");
const [responseFile, configFile] = process.argv.slice(2);
const response = JSON.parse(fs.readFileSync(responseFile, "utf8"));
for (const field of ["relayUrl", "userId", "deviceId", "hostId", "hostName"]) {
  if (!response[field]) {
    throw new Error(`Bootstrap response missing ${field}`);
  }
}
const project = response.project && response.project.path
  ? response.project
  : {
      id: process.env.PROJECT_ID,
      name: process.env.PROJECT_NAME,
      path: process.env.PROJECT_PATH,
    };
fs.writeFileSync(
  configFile,
  `${JSON.stringify({
    relayUrl: response.relayUrl,
    userId: response.userId,
    deviceId: response.deviceId,
    hostId: response.hostId,
    hostName: response.hostName,
    projects: [project],
  }, null, 2)}\n`,
);
NODE
else
  required CODEX_LINK_USER_ID
  required CODEX_LINK_DEVICE_ID
  required CODEX_LINK_HOST_ID

  node - "$CONFIG_FILE" <<'NODE'
const fs = require("node:fs");
const [configFile] = process.argv.slice(2);
fs.writeFileSync(
  configFile,
  `${JSON.stringify({
    relayUrl: process.env.CODEX_LINK_RELAY_URL,
    userId: process.env.CODEX_LINK_USER_ID,
    deviceId: process.env.CODEX_LINK_DEVICE_ID,
    hostId: process.env.CODEX_LINK_HOST_ID,
    hostName: process.env.HOST_NAME,
    projects: [
      {
        id: process.env.PROJECT_ID,
        name: process.env.PROJECT_NAME,
        path: process.env.PROJECT_PATH,
      },
    ],
  }, null, 2)}\n`,
);
NODE
fi

chmod 600 "$CONFIG_FILE"

echo "Codex Link Host config written: $CONFIG_FILE"
echo "Start with: pnpm --filter @codex-link/mac-host exec codex-link-mac-host $CONFIG_FILE"
