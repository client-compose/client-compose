#!/usr/bin/env bash
# One-off, run by a maintainer on their own machine (after `npm login`):
# npm trusted publishing can only be configured for packages that already exist, so the very first
# versions are published from here. This script publishes them, pushes the release tags, and then
# trusts .github/workflows/release.yml to publish every later version (no npm tokens needed).
set -euo pipefail

cd "$(dirname "$0")/.."
NPM="npx -y npm@11.19.0" # `npm trust` needs a recent npm

who="$(npm whoami 2>/dev/null)" || { echo "Not logged in to npm. Run: npm login" >&2; exit 1; }
echo "Publishing as npm user: $who"

git fetch -q origin main
if [ -n "$(git status --porcelain)" ] || [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "Run this from a clean checkout of origin/main." >&2
  exit 1
fi

pnpm install --frozen-lockfile
scripts/check-packages.sh # builds everything and install-tests the tarballs

# Publishes every package whose version isn't on npm yet, and creates a git tag for each.
pnpm changeset publish
git push origin --tags

for pkg in $(pnpm -r exec node -p "require('./package.json').name"); do
  echo "Trusting release.yml to publish $pkg"
  $NPM trust github "$pkg" --file release.yml --repository client-compose/client-compose --allow-publish --yes
done

echo
echo "Done. Later releases publish from CI via the Release packages PR."
