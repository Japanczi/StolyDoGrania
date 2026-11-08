#!/usr/bin/env bash
# One-time (idempotent) server preparation for Planszowkarz on a Mikrus VPS.
# Usage on the server: bash server-setup.sh <app_port>
# Expects planszowkarz.service and planszowkarz.env.example next to this script.
set -euo pipefail

PORT="${1:?Usage: server-setup.sh <app_port>}"
ROOT=/opt/planszowkarz
HERE="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$ROOT/app" "$ROOT/data" "$ROOT/backup"

# Weekly board reset uses the server's local time zone.
timedatectl set-timezone Europe/Warsaw 2>/dev/null || ln -sf /usr/share/zoneinfo/Europe/Warsaw /etc/localtime

# .NET needs ICU for Polish formatting and sorting.
if ! compgen -G "/usr/lib/x86_64-linux-gnu/libicuuc.so.*" > /dev/null; then
    apt-get update -q
    ICU_PKG="$(apt-cache search --names-only '^libicu[0-9]+$' | awk '{print $1}' | sort -V | tail -1)"
    apt-get install -y -q "$ICU_PKG"
fi

# Settings file: created once, never overwritten (it holds the secrets).
if [ ! -f "$ROOT/planszowkarz.env" ]; then
    sed "s/__PORT__/$PORT/" "$HERE/planszowkarz.env.example" > "$ROOT/planszowkarz.env"
    echo "Created $ROOT/planszowkarz.env – fill in the CHANGE_ME values."
fi
chmod 600 "$ROOT/planszowkarz.env"

install -m 644 "$HERE/planszowkarz.service" /etc/systemd/system/planszowkarz.service
systemctl daemon-reload
systemctl enable planszowkarz >/dev/null

echo "Server ready. App port: $PORT"
