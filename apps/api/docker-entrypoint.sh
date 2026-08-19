#!/bin/sh
# Container entrypoint: migrate, then start.
#
# ★ Migrations run here rather than in Railway's pre-deploy step.
#
# The pre-deploy step failed on this project with `failureStage:
# PRE_DEPLOY_COMMAND` and produced no readable output — the deployment simply
# went FAILED with empty logs, which is close to undiagnosable. Running the
# migration as part of the container's own startup puts the output in the
# service log where it can actually be read, and `set -e` means a failed
# migration still stops the deploy rather than starting an app against a schema
# that is not there.
#
# The trade-off is that with more than one replica each would attempt to
# migrate. Prisma takes an advisory lock, so the second waits and then finds
# nothing to do — safe, and this service runs a single replica anyway.
set -e

echo "[entrypoint] applying database migrations…"
cd /app/apps/api
./node_modules/.bin/prisma migrate deploy
echo "[entrypoint] migrations applied; starting the API"

cd /app
exec node apps/api/dist/main.js
