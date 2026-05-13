#!/usr/bin/env bash
# codex-link-cli-attach.sh
# Read the Mac Host's currently advertised Codex app-server URL from
# $TMPDIR/codex-link-app-server.json and launch `codex tui --remote ...`
# so the CLI joins the same app-server that Mac Host / VS Code / iPhone
# are using.

set -euo pipefail

RUNTIME_FILE="${CODEX_LINK_APP_SERVER_INFO:-${TMPDIR:-/tmp}/codex-link-app-server.json}"
if [ ! -f "$RUNTIME_FILE" ]; then
  echo "Codex Link Mac Host runtime info not found at $RUNTIME_FILE" >&2
  echo "Start mac-host first (pnpm --filter @codex-link/mac-host start ...)" >&2
  exit 1
fi

URL=$(node -e '
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!data.url) { process.exit(2); }
process.stdout.write(data.url);
' "$RUNTIME_FILE")

if [ -z "$URL" ]; then
  echo "Failed to read app-server URL from $RUNTIME_FILE" >&2
  exit 1
fi

exec codex tui --remote "$URL" "$@"
