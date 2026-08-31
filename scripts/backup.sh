#!/usr/bin/env bash
#
# Nightly backup of the database and the object store.
#
# ★★★ **This is the single most important file added by the move off Railway.**
#
# Railway took a managed snapshot of Postgres every night and nobody had to
# think about it. On a VPS nothing does that, and the failure mode is not a
# broken deploy — it is a disk that dies eighteen months from now with every
# child's photographs and every financial record on it. `docs/PROD_RECOVERY.md`
# is a real document about a real incident; it was survivable because the data
# still existed.
#
# ★ Both halves matter. `pg_dump` alone restores a database full of rows whose
# `storageKey` points at objects that are gone — a portfolio of broken images
# and a media route that 404s for every file.
#
# Install (on the server, as the user that owns the deployment):
#
#   crontab -e
#   15 2 * * * /opt/nomadkids/scripts/backup.sh >> /var/log/nomadkids-backup.log 2>&1
#
# Then, within the week, RESTORE ONE somewhere else. An untested backup is a
# belief, not a backup — §4 of docs/VPS_DEPLOYMENT.md says how.

set -euo pipefail

# The directory holding docker-compose.prod.yml.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE="docker compose -f docker-compose.prod.yml"
STAMP="$(date +%Y-%m-%d_%H%M)"
DEST="${BACKUP_DIR:-$ROOT/backups}"

# How long to keep. Fourteen days covers "somebody noticed on Monday that
# something went wrong before the weekend", which is the realistic detection
# window for data damage that is not a total outage.
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$DEST"

if [ -f .env.production ]; then
  # shellcheck disable=SC1091
  set -a && . ./.env.production && set +a
fi

: "${POSTGRES_USER:?POSTGRES_USER is not set — is .env.production present?}"
: "${POSTGRES_DB:?POSTGRES_DB is not set}"
: "${STORAGE_BUCKET:?STORAGE_BUCKET is not set}"

log() { printf '[backup %s] %s\n' "$(date +%H:%M:%S)" "$1"; }

log "starting — destination $DEST"

# ── Postgres ─────────────────────────────────────────────────────────────────
#
# ★ `--format=custom`, not plain SQL. It compresses, and `pg_restore` can then
# restore a single table from it — which is what an accidental DELETE needs,
# rather than replaying the whole database over a live one.
DB_FILE="$DEST/db-$STAMP.dump"

log "dumping postgres…"
$COMPOSE exec -T db pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format=custom \
  --compress=9 \
  > "$DB_FILE"

# ★★ A dump that exists is not a dump that worked. `pg_dump` writing a
# zero-byte file on a broken connection is exactly the failure a nightly cron
# hides for months, because the cron reports success and the file is there.
DB_SIZE=$(wc -c < "$DB_FILE")
if [ "$DB_SIZE" -lt 10000 ]; then
  log "FAILED: dump is only ${DB_SIZE} bytes — refusing to call this a backup"
  rm -f "$DB_FILE"
  exit 1
fi

# `pg_restore --list` parses the archive's table of contents. It fails on a
# truncated or corrupt file, which byte-counting alone would not catch.
if ! $COMPOSE exec -T db pg_restore --list < "$DB_FILE" > /dev/null 2>&1; then
  log "FAILED: the dump is not a readable archive"
  rm -f "$DB_FILE"
  exit 1
fi

log "postgres ok — $(du -h "$DB_FILE" | cut -f1)"

# ── Object storage ───────────────────────────────────────────────────────────
#
# ★ `mc mirror` copies only what changed, so night two is fast even though the
# bucket holds every photograph ever uploaded. `--remove` is deliberately NOT
# passed: a file deleted in MinIO stays in the mirror, which is the whole point
# of having one.
MEDIA_DIR="$DEST/media"
mkdir -p "$MEDIA_DIR"

log "mirroring object storage…"
$COMPOSE run --rm --entrypoint /bin/sh \
  -v "$MEDIA_DIR:/backup" \
  storage-init -c "
    mc alias set local http://storage:9000 \"\$STORAGE_ACCESS_KEY_ID\" \"\$STORAGE_SECRET_ACCESS_KEY\" >/dev/null &&
    mc mirror --overwrite local/\"\$STORAGE_BUCKET\" /backup
  " > /dev/null

log "storage ok — $(du -sh "$MEDIA_DIR" | cut -f1)"

# ── Retention ────────────────────────────────────────────────────────────────
#
# Only the dumps are pruned. The media mirror is cumulative on purpose: it is a
# copy of what exists now, and deleting from it would delete the only remaining
# copy of a photograph somebody removed by mistake.
log "pruning dumps older than ${KEEP_DAYS} days…"
find "$DEST" -maxdepth 1 -name 'db-*.dump' -type f -mtime "+$KEEP_DAYS" -print -delete || true

# ── Report ───────────────────────────────────────────────────────────────────
COUNT=$(find "$DEST" -maxdepth 1 -name 'db-*.dump' -type f | wc -l | tr -d ' ')
log "done — ${COUNT} dump(s) retained, $(df -Ph "$DEST" | awk 'NR==2 {print $4}') free on disk"

# ★★★ The line that turns this from a local copy into a backup.
#
# A backup on the same disk as the thing it backs up is not a backup: it
# survives `DROP TABLE` and dies with the disk, the datacentre, or the invoice
# nobody paid. Ship it off the box — one of these, uncommented and configured:
#
#   rclone sync "$DEST" remote:nomadkids-backups   # any S3/Drive/Backblaze
#   rsync -az --delete "$DEST/" backup-host:/srv/nomadkids/
#
# Until one of them runs, this script protects against exactly one failure —
# somebody deleting data inside a healthy server — and no others.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  log "syncing to $BACKUP_REMOTE…"
  rclone sync "$DEST" "$BACKUP_REMOTE" && log "offsite copy ok"
else
  log "WARNING: BACKUP_REMOTE is not set — this backup lives on the same disk as the data"
fi
