#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d .tools/node/bin ]; then export PATH="$PWD/.tools/node/bin:$PATH"; fi
if ! command -v node >/dev/null; then
  echo '需要 Node.js 24+。请先安装 Linux Node.js。' >&2
  exit 1
fi
exec npm run dev
