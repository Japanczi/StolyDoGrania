#!/usr/bin/env bash
# On the server: backs up the live .NET database (consistent online copy) and converts that copy into the Node app's
# database. Any existing Node database is moved into the backup folder first, never deleted.
# Usage: bash /opt/planszowkarz/node/deploy/convert-live-db.sh   (the Node service must be stopped)
set -euo pipefail

ROOT=/opt/planszowkarz
NODE=/opt/node/bin/node
STAMP="$(date +%Y%m%d-%H%M%S)"
SOURCE="$ROOT/data/app.db"
COPY="$ROOT/backup/app-$STAMP.db"
TARGET="$ROOT/data/planszowkarz.db"

if systemctl is-active --quiet planszowkarz-node; then
    echo "Stop the Node service first: systemctl stop planszowkarz-node" >&2
    exit 1
fi

cd "$ROOT/node"
"$NODE" scripts/backup-sqlite.ts "$SOURCE" "$COPY"

for suffix in "" -wal -shm; do
    if [ -f "$TARGET$suffix" ]; then
        mv "$TARGET$suffix" "$ROOT/backup/planszowkarz-replaced-$STAMP.db$suffix"
    fi
done

"$NODE" scripts/import-dotnet-db.ts "$COPY" "$TARGET"
echo "Converted $COPY into $TARGET"
