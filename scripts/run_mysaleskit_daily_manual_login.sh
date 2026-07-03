#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export MYSK_PORTAL_HEADLESS=false
export MYSK_MANUAL_LOGIN_WAIT_MS="${MYSK_MANUAL_LOGIN_WAIT_MS:-900000}"

exec "$SCRIPT_DIR/run_mysaleskit_cron.sh"
