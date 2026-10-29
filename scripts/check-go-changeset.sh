#!/usr/bin/env bash
# Fails when a change to the Go composer's code has no changeset naming `go-composer`, so it's
# released (release/go-composer). Tests, test data and docs alone don't need one. CI runs it on pull
# requests, against their base.
#
#   scripts/check-go-changeset.sh origin/main
set -euo pipefail

base="${1:?usage: scripts/check-go-changeset.sh <base-ref>}"
changed="$(git diff --name-only "$base"...HEAD -- composers/go/core \
  ':!composers/go/core/*_test.go' ':!composers/go/core/*testdata/*' ':!composers/go/core/*.md')"

if [ -z "$changed" ]; then
  exit 0
fi

for changeset in $(git diff --name-only --diff-filter=AM "$base"...HEAD -- '.changeset/*.md'); do
  if grep -Eq '^"?go-composer"?: (patch|minor|major)' "$changeset"; then
    exit 0
  fi
done

echo "The Go composer changed, with no changeset naming go-composer:"
echo "$changed" | sed 's/^/  /'
echo "Add one with \`pnpm changeset\`, choosing go-composer (see release/go-composer)."
exit 1
