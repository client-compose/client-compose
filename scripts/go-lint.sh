#!/usr/bin/env bash
# Formats or lints every Go module in this repo with golangci-lint (rules in .golangci.yml).
#
#   scripts/go-lint.sh check   formatting and lint, changing nothing (CI)
#   scripts/go-lint.sh fix     format, and fix what the linters can
set -euo pipefail

version="v2.14.0"
root="$(cd "$(dirname "$0")/.." && pwd)"
lint=(go run "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@${version}")
# Every hand-written module. Codegen's golden output is checked by its own tests.
modules=(composers/go/core examples/todo/composer-go)

for module in "${modules[@]}"; do
  echo "== ${module}"
  cd "${root}/${module}"
  case "${1:-check}" in
    check)
      "${lint[@]}" fmt --config "${root}/.golangci.yml" --diff ./...
      "${lint[@]}" run --config "${root}/.golangci.yml" ./...
      ;;
    fix)
      "${lint[@]}" fmt --config "${root}/.golangci.yml" ./...
      "${lint[@]}" run --config "${root}/.golangci.yml" --fix ./...
      ;;
    *)
      echo "usage: scripts/go-lint.sh check|fix" >&2
      exit 2
      ;;
  esac
done
