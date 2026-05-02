#!/usr/bin/env bash
# health-check.sh — Check the health of all Clover backend services.
#
# Calls GET /api/health on the gateway and prints the status of each
# component. Exits 0 if all services are healthy, exits 1 if any are
# unhealthy or the gateway is unreachable.

set -euo pipefail

GATEWAY_PORT="${CLOVER_GATEWAY_PORT:-3001}"
GATEWAY_HOST="${CLOVER_GATEWAY_HOST:-localhost}"
HEALTH_URL="http://${GATEWAY_HOST}:${GATEWAY_PORT}/api/health"

# ── Fetch health status ──────────────────────────────────────────────────

echo "Checking Clover health at ${HEALTH_URL}..."
echo ""

HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" "$HEALTH_URL" 2>&1) || {
  echo "ERROR: Could not reach the gateway at ${HEALTH_URL}."
  echo "Is the backend running?"
  exit 1
}

# Split response body and HTTP status code
HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n1)

if [ -z "$HTTP_BODY" ]; then
  echo "ERROR: Empty response from gateway."
  exit 1
fi

# ── Parse and display component statuses ─────────────────────────────────

# Check if jq is available for pretty output; fall back to raw JSON
if command -v jq &>/dev/null; then
  SERVICES=("openclaude" "ollama" "lancedb" "sqlite")
  ANY_UNHEALTHY=0

  for service in "${SERVICES[@]}"; do
    status=$(echo "$HTTP_BODY" | jq -r ".${service}.status" 2>/dev/null)
    message=$(echo "$HTTP_BODY" | jq -r ".${service}.message" 2>/dev/null)

    if [ "$status" = "healthy" ]; then
      echo "  ✓ ${service}: ${message}"
    else
      echo "  ✗ ${service}: ${message}"
      ANY_UNHEALTHY=1
    fi
  done

  echo ""

  if [ "$ANY_UNHEALTHY" -eq 1 ]; then
    echo "Some services are unhealthy. (HTTP ${HTTP_CODE})"
    exit 1
  else
    echo "All services are healthy. (HTTP ${HTTP_CODE})"
    exit 0
  fi
else
  # No jq — print raw JSON and check for "unhealthy" in the response
  echo "Raw health response (install jq for formatted output):"
  echo "$HTTP_BODY"
  echo ""
  echo "HTTP status: ${HTTP_CODE}"

  if echo "$HTTP_BODY" | grep -q '"unhealthy"'; then
    echo "Some services are unhealthy."
    exit 1
  else
    echo "All services appear healthy."
    exit 0
  fi
fi
