#!/usr/bin/env bash
# start-openclaude.sh — Start the OpenClaude gRPC server and wait for it to be ready.
#
# Checks that the openclaude binary is installed, starts the gRPC server
# on port 50051, and waits up to 30 seconds for the port to become ready.
# Exits 0 on success, 1 on failure.

set -euo pipefail

GRPC_PORT="${OPENCLAUDE_PORT:-50051}"
GRPC_HOST="${OPENCLAUDE_HOST:-localhost}"
TIMEOUT=30

# ── Locate openclaude binary ──────────────────────────────────────────────

OPENCLAUDE_BIN="${OPENCLAUDE_BIN:-openclaude}"

if ! command -v "$OPENCLAUDE_BIN" &>/dev/null; then
  echo "ERROR: openclaude binary not found in PATH."
  echo "Install OpenClaude or set OPENCLAUDE_BIN to the full path."
  exit 1
fi

echo "Found openclaude at: $(command -v "$OPENCLAUDE_BIN")"

# ── Start gRPC server ────────────────────────────────────────────────────

echo "Starting OpenClaude gRPC server on :${GRPC_PORT}..."
"$OPENCLAUDE_BIN" --port "$GRPC_PORT" &
OPENCLAUDE_PID=$!

# Ensure the child process is cleaned up if this script is interrupted
trap 'kill "$OPENCLAUDE_PID" 2>/dev/null || true' EXIT

# ── Wait for port to be ready ────────────────────────────────────────────

echo "Waiting up to ${TIMEOUT}s for gRPC port ${GRPC_PORT} to be ready..."

elapsed=0
while [ "$elapsed" -lt "$TIMEOUT" ]; do
  # Check if the process is still alive
  if ! kill -0 "$OPENCLAUDE_PID" 2>/dev/null; then
    echo "ERROR: OpenClaude process exited unexpectedly."
    exit 1
  fi

  # Try to connect to the port
  if (echo >/dev/tcp/"$GRPC_HOST"/"$GRPC_PORT") 2>/dev/null; then
    echo "OpenClaude gRPC server is ready on :${GRPC_PORT} (took ${elapsed}s)."
    # Remove the trap so we don't kill the server on normal exit
    trap - EXIT
    exit 0
  fi

  sleep 1
  elapsed=$((elapsed + 1))
done

echo "ERROR: OpenClaude failed to start within ${TIMEOUT}s."
kill "$OPENCLAUDE_PID" 2>/dev/null || true
exit 1
