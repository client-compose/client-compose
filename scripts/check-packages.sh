#!/usr/bin/env bash
# Builds, packs and lints every publishable package, then installs the tarballs into a fresh project
# and uses them the way a consumer would. Run before releasing; CI runs it on every change.
#
#   scripts/check-packages.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/client-compose-packages.XXXXXX")"
trap 'rm -rf "$work"' EXIT
fixtures="$root/scripts/package-consumer"

step() { printf '\n== %s\n' "$*"; }

cd "$root"
step "build"
pnpm build

step "pack"
pnpm -r pack --pack-destination "$work/tarballs" >/dev/null
ls "$work/tarballs"

step "lint packages (publint, are-the-types-wrong)"
for dir in $(pnpm -r exec pwd); do
  (cd "$dir" && pnpm exec publint --pack pnpm --strict)
done
for tgz in "$work"/tarballs/*.tgz; do
  pnpm exec attw "$tgz" --profile esm-only --format table-flipped
done

step "install tarballs into a fresh consumer project"
mkdir "$work/consumer"
cp -R "$fixtures"/. "$work/consumer/"
cd "$work/consumer"
npm install --no-audit --no-fund --loglevel=error "$work"/tarballs/*.tgz
npm ls --depth 1 | grep @client-compose

step "type-check consumers (moduleResolution nodenext and bundler)"
npx tsc -p tsconfig.nodenext.json
npx tsc -p tsconfig.bundler.json

step "run consumers"
node smoke.mjs

step "CLIs"
node smoke-server.mjs 4199 &
server=$!
trap 'kill $server 2>/dev/null || true; rm -rf "$work"' EXIT
for _ in $(seq 1 50); do (exec 3<>/dev/tcp/127.0.0.1/4199) 2>/dev/null && break; sleep 0.1; done
npx client-compose-conformance composer http://127.0.0.1:4199
npx client-compose-codegen --check "$root/codegen/test/fixtures/client-compose.codegen.json" \
  "$root/examples/profile/client-compose.codegen.json"

printf '\nAll package checks passed.\n'
