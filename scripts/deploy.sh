#!/usr/bin/env bash
# AgentHill — deploy to the VPS. Run from a local checkout, after `git push`.
#
#   bash scripts/deploy.sh              # pull, build what changed, restart, smoke
#   bash scripts/deploy.sh --install    # + pnpm install (dependencies changed)
#   bash scripts/deploy.sh --db         # + prisma db push (schema changed)
#   bash scripts/deploy.sh --first      # first deployment: clone, install, db, all
#
# The doctrine this encodes, learned the hard way on animam.ai:
#   - check free memory BEFORE building; an OOM kill mid-build leaves a broken tree
#   - build in the FOREGROUND, one app at a time, never in the background
#   - verify the VPS actually moved to the commit we think it did
#   - restart only what changed, and smoke the live URL afterwards
set -euo pipefail

HOST="${AGENTHILL_HOST:-debian@54.37.40.223}"
KEY="${AGENTHILL_KEY:-$HOME/.ssh/id_ed25519}"
DIR="/home/debian/sites/agenthill"
REPO="https://github.com/wellknownmcp/agenthill.git"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$HOST")

INSTALL=0; DB=0; FIRST=0
for a in "$@"; do
  case "$a" in
    --install) INSTALL=1 ;;
    --db) DB=1 ;;
    --first) FIRST=1; INSTALL=1; DB=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

LOCAL_HEAD=$(git rev-parse HEAD)
echo "▸ local HEAD $LOCAL_HEAD"

if [ "$FIRST" = "1" ]; then
  echo "▸ first deployment: cloning"
  "${SSH[@]}" "set -euo pipefail; mkdir -p ~/sites; [ -d $DIR/.git ] || git clone $REPO $DIR"
  echo "  → put the secrets in $DIR/.env on the server before continuing (see .env.example)"
fi

echo "▸ sanity: a .env with CRLF line endings poisons every secret it holds"
"${SSH[@]}" "set -euo pipefail; cd $DIR && if file .env | grep -q CRLF; then echo '  fixing CRLF in .env'; sed -i 's/$//' .env; fi; file .env"

echo "▸ memory before anything"
"${SSH[@]}" "free -h | head -2"

echo "▸ pull"
"${SSH[@]}" "set -euo pipefail; cd $DIR && git fetch --quiet origin && git reset --hard --quiet origin/main && git rev-parse HEAD"
REMOTE_HEAD=$("${SSH[@]}" "cd $DIR && git rev-parse HEAD")
if [ "$REMOTE_HEAD" != "$LOCAL_HEAD" ]; then
  echo "✗ the VPS is on $REMOTE_HEAD, not $LOCAL_HEAD — did you push?" >&2
  exit 1
fi
echo "  ✓ VPS on $REMOTE_HEAD"

if [ "$INSTALL" = "1" ]; then
  echo "▸ install"
  "${SSH[@]}" "set -euo pipefail; cd $DIR && . ~/.nvm/nvm.sh && pnpm install --frozen-lockfile"
fi

echo "▸ prisma client"
"${SSH[@]}" "set -euo pipefail; cd $DIR && . ~/.nvm/nvm.sh && node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma"

if [ "$DB" = "1" ]; then
  echo "▸ schema → database (db push, never migrate: shadow-db permissions fail in prod)"
  "${SSH[@]}" "set -euo pipefail; cd $DIR && . ~/.nvm/nvm.sh && set -a && . ./.env && set +a && node node_modules/prisma/build/index.js db push --schema prisma/schema.prisma --skip-generate"
fi

echo "▸ tests (the engine must be green on the machine that runs it)"
"${SSH[@]}" "set -euo pipefail; cd $DIR && . ~/.nvm/nvm.sh && pnpm test 2>&1 | tail -3"

echo "▸ build the page (foreground, alone)"
"${SSH[@]}" "set -euo pipefail; cd $DIR && . ~/.nvm/nvm.sh && free -h | sed -n 2p && cd apps/web && set -a && . ../../.env && set +a && NODE_OPTIONS=--max-old-space-size=2048 ../../node_modules/.bin/next build 2>&1 | tail -12"

echo "▸ restart"
"${SSH[@]}" "set -euo pipefail; cd $DIR && . ~/.nvm/nvm.sh && set -a && . ./.env && set +a && (pm2 restart agenthill-server agenthill-web --update-env || pm2 start deploy/ecosystem.config.cjs) && pm2 save >/dev/null"

echo "▸ smoke"
sleep 4
for url in "https://agenthill.lol/" "https://agenthill.lol/llms.txt" "https://agenthill.lol/api/hill" "https://mcp.agenthill.lol/.well-known/oauth-protected-resource"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || echo 000)
  printf '  %-58s %s\n' "$url" "$code"
done
echo "  MCP without a token (expect 401 + WWW-Authenticate):"
curl -s -i -X POST --max-time 15 https://mcp.agenthill.lol/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | sed -n '1p;/WWW-Authenticate/p'
echo "  AI fetchers (expect 200, never a challenge):"
for ua in GPTBot ClaudeBot PerplexityBot; do
  printf '  %-12s %s\n' "$ua" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -A "$ua/1.0" https://agenthill.lol/llms.txt || echo 000)"
done
echo "▸ done"
