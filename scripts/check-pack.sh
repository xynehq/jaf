#!/usr/bin/env bash
# Packs the library and loads it from an empty project with plain Node, as a consumer would.
# Run after `pnpm build`.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

cd "$REPO_DIR"
pnpm pack --pack-destination "$WORK_DIR" >/dev/null
TARBALL="$(ls "$WORK_DIR"/*.tgz)"

cd "$WORK_DIR"
npm init -y >/dev/null
npm install --no-audit --no-fund --loglevel=error "$TARBALL" >/dev/null

node -e "import('@juspay-jaf/jaf').then(m => { if (typeof m.createJAFServer !== 'function') throw new Error('createJAFServer missing'); console.log('ok   @juspay-jaf/jaf'); })"
node -e "import('@juspay-jaf/jaf/server').then(m => { if (typeof m.createJAFServer !== 'function') throw new Error('createJAFServer missing'); console.log('ok   @juspay-jaf/jaf/server'); })"
echo "packed tarball loads from an empty project"
