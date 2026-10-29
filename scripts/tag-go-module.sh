#!/usr/bin/env bash
# Tags the Go composer at the version Changesets gave it (release/go-composer), and creates its
# GitHub release with that version's changelog, unless it's tagged already. The release workflow
# runs it on every push to main.
#
#   scripts/tag-go-module.sh
#
# Needs a checkout with its tags, push access, and GH_TOKEN for the release.
set -euo pipefail

cd "$(dirname "$0")/.."
version="$(node -p 'require("./release/go-composer/package.json").version')"
tag="composers/go/core/v$version"

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "$tag is tagged already"
  exit 0
fi

# This version's section of the changelog: from its heading to the next one.
notes="$(awk -v heading="## $version" '
  $0 == heading { found = 1; next }
  found && /^## / { exit }
  found { print }
' release/go-composer/CHANGELOG.md)"

git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  tag -a "$tag" -m "$tag"
git push origin "$tag"
gh release create "$tag" --title "$tag" --notes "$notes" --verify-tag
echo "tagged $tag"
