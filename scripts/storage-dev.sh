#!/usr/bin/env bash
#
# Starts MinIO for local development on a machine with no Docker.
#
# ★ docker-compose.yml is still the reference. This runs the same server, on
# the same ports (9002 API, 9003 console) with the same credentials, so .env
# needs no change and the two are interchangeable — `docker compose up -d
# storage` remains the right command wherever Docker exists.
#
# Object storage is not optional in this product: every photograph, every
# document PDF and every generated report goes through it, and without it those
# uploads fail. That is the outage this script exists to end.
#
#   ./scripts/storage-dev.sh          # start, and create the bucket
#   ./scripts/storage-dev.sh stop     # stop it again
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${MINIO_DATA_DIR:-$ROOT/.minio-data}"
PID_FILE="$DATA_DIR/minio.pid"
LOG_FILE="$DATA_DIR/minio.log"

# Credentials and ports come from .env, so this cannot drift from what the API
# is configured to talk to.
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

PORT="${STORAGE_ENDPOINT##*:}"
PORT="${PORT%%/*}"

stop() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    kill "$(cat "$PID_FILE")"
    rm -f "$PID_FILE"
    echo "MinIO stopped."
  else
    echo "MinIO is not running."
  fi
}

if [[ "${1:-start}" == "stop" ]]; then
  stop
  exit 0
fi

if ! command -v minio >/dev/null 2>&1; then
  cat <<'MSG'
minio is not installed.

  brew install minio/stable/minio

(Or start Docker Desktop and use `docker compose up -d storage` instead —
that is what docker-compose.yml is for.)
MSG
  exit 1
fi

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "MinIO is already running (pid $(cat "$PID_FILE"))."
else
  mkdir -p "$DATA_DIR"
  MINIO_ROOT_USER="$STORAGE_ACCESS_KEY_ID" \
  MINIO_ROOT_PASSWORD="$STORAGE_SECRET_ACCESS_KEY" \
    minio server "$DATA_DIR" --address ":$PORT" --console-address ":9003" \
    >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  echo "MinIO starting on $STORAGE_ENDPOINT (log: $LOG_FILE)"
fi

# Wait for it to answer before asking for the bucket — MinIO takes a moment to
# bind, and a CreateBucket against a socket that is not listening yet fails in a
# way that reads like a configuration error.
for _ in $(seq 1 30); do
  if curl -fsS --max-time 1 "$STORAGE_ENDPOINT/minio/health/live" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

pnpm --filter api exec tsx scripts/ensure-bucket.ts
