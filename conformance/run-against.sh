#!/usr/bin/env bash
# Start a composer's conformance server, run the shared suite against it, stop it.
#
#   conformance/run-against.sh <port> <command to start the server...>
#
# e.g. conformance/run-against.sh 4100 go run ./composers/go/core/cmd/conformance-server -addr :4100 \
#        -strings conformance/composer/strings
set -euo pipefail

port="$1"
shift
root="$(cd "$(dirname "$0")/.." && pwd)"

"$@" &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 100); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "conformance server exited before listening on :$port" >&2
    exit 1
  fi
  sleep 0.2
done

node "$root/conformance/runner/cli.ts" composer "http://127.0.0.1:$port"
