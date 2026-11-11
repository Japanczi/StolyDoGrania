#!/usr/bin/env bash
# One-time (idempotent) server preparation for the Node version of Planszowkarz on the Mikrus VPS.
# Usage on the server: bash server-setup-node.sh <app_port> <node_version>
# Expects planszowkarz-node.service and convert-env.sh next to this script.
# Leaves the .NET app (/opt/planszowkarz/app, service "planszowkarz", its env file) untouched.
set -euo pipefail

PORT="${1:?Usage: server-setup-node.sh <app_port> <node_version>}"
NODE_VERSION="${2:?Usage: server-setup-node.sh <app_port> <node_version>}"
ROOT=/opt/planszowkarz
HERE="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$ROOT/node" "$ROOT/data" "$ROOT/backup" "$ROOT/app/Claude_Resources/Feedback"

# Node's Linux build needs libatomic, which minimal Ubuntu images (like Mikrus's) don't have.
if ! ldconfig -p | grep -q libatomic.so.1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -q
    apt-get install -y -q libatomic1
fi

# Node.js: the official Linux x64 build, checked against nodejs.org's published SHA-256 list.
if [ "$(/opt/node/bin/node -v 2>/dev/null || true)" != "v$NODE_VERSION" ]; then
    TMP="$(mktemp -d)"
    NAME="node-v$NODE_VERSION-linux-x64"
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$NAME.tar.xz" -o "$TMP/$NAME.tar.xz"
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
    (cd "$TMP" && grep " $NAME.tar.xz\$" SHASUMS256.txt | sha256sum -c -)
    rm -rf /opt/node.new && mkdir -p /opt/node.new
    tar -xJf "$TMP/$NAME.tar.xz" -C /opt/node.new --strip-components=1
    rm -rf /opt/node && mv /opt/node.new /opt/node
    rm -rf "$TMP"
    echo "Installed Node $(/opt/node/bin/node -v) in /opt/node"
fi

# Settings file: created once from the .NET settings (secrets copied server-side, never printed), never overwritten.
if [ ! -f "$ROOT/planszowkarz-node.env" ]; then
    bash "$HERE/convert-env.sh" "$ROOT/planszowkarz.env" "$ROOT/planszowkarz-node.env" "$PORT"
    echo "Created $ROOT/planszowkarz-node.env from $ROOT/planszowkarz.env"
fi
chmod 600 "$ROOT/planszowkarz-node.env"

install -m 644 "$HERE/planszowkarz-node.service" /etc/systemd/system/planszowkarz-node.service
systemctl daemon-reload

echo "Server ready for Node. App port: $PORT"
