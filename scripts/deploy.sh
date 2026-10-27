#!/bin/sh
# Deploys a commit to the VPS from the images GitHub built — no build here.
#
#   sudo scripts/deploy.sh            # the latest main
#   sudo scripts/deploy.sh <sha>      # a specific commit, e.g. to roll back
#
# ★ 2026-10-27: building api, reports-worker and web on this 4 GB machine ran
# it out of memory and the live containers were OOM-killed mid-deploy.
# `.github/workflows/images.yml` builds them; this pulls and swaps.
#
# Once, before the first run: `docker login ghcr.io -u <github-user>` with a
# token that has `read:packages` (the packages are private).
set -eu
cd "$(dirname "$0")/.."

TAG="${1:-}"
sudo -u deploy git pull --ff-only origin main
[ -n "$TAG" ] || TAG="$(git rev-parse HEAD)"
export IMAGE_TAG="$TAG"
C="docker compose -f docker-compose.prod.yml"

echo "== deploying $TAG"
# Fails here, with nothing changed, if CI has not finished building this commit.
$C pull api reports-worker web

# The API's entrypoint runs `prisma migrate deploy` — take a backup first
# when the commit carries a migration (CLAUDE.md §8).
$C up -d --no-build api reports-worker
$C up -d --no-build web

echo "== waiting for health"
i=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${API_HEALTH_URL:-https://api.nomadkids.mn/v1/health}")" = "200" ]; do
  i=$((i + 1))
  [ "$i" -ge 30 ] && { echo "API not healthy after 5 minutes"; $C ps; exit 1; }
  sleep 10
done
$C ps --format '{{.Service}} {{.Status}}'
echo "== deployed $TAG"
