#!/usr/bin/env bash
# Builds standalone client-compose-codegen executables, so Go, Swift and Kotlin teams can run codegen
# without installing Node. Cross-compiles every target from one machine with Bun.
#
#   scripts/build-codegen-binaries.sh [out-dir]          # default: build/codegen-binaries
#   TARGETS="linux-x64" scripts/build-codegen-binaries.sh  # just some targets
#   BUN=bun scripts/build-codegen-binaries.sh               # use an installed Bun
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/build/codegen-binaries}"
BUN="${BUN:-npx -y bun@1.4.2}"
TARGETS="${TARGETS:-linux-x64 linux-arm64 darwin-x64 darwin-arm64 windows-x64}"
version="$(node -p 'require(process.argv[1]).version' "$root/codegen/package.json")"

rm -rf "$out"
mkdir -p "$out"
for target in $TARGETS; do
  name="client-compose-codegen-$target"
  [[ $target == windows-* ]] && name="$name.exe"
  echo "building $name ($version)"
  $BUN build "$root/codegen/src/cli.ts" --compile --minify --target="bun-$target" \
    --define "__CLIENT_COMPOSE_CODEGEN_VERSION__=\"$version\"" \
    --outfile "$out/$name" >/dev/null
done

(cd "$out" && shasum -a 256 client-compose-codegen-* > SHA256SUMS)
ls -lh "$out"
