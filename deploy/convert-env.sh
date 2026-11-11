#!/usr/bin/env bash
# Builds the Node app's settings file from the .NET app's one, on the server. Secrets are copied from file to file
# and never printed. .NET spells nested keys with "__" (Bgg__Token); the Node app uses plain names (BGG_TOKEN).
# Usage: bash convert-env.sh <.NET env file> <new Node env file> <port>
set -euo pipefail

SRC="${1:?source env}"
DST="${2:?target env}"
PORT="${3:?port}"

# Reads one value from the .NET file (last occurrence wins, like systemd); empty when missing.
get() { grep -E "^$1=" "$SRC" | tail -1 | cut -d= -f2- || true; }

security() {
    case "$(get Email__Security)" in
        SslOnConnect) echo ssl ;;
        None) echo none ;;
        *) echo starttls ;;
    esac
}

umask 077
{
    echo "# Settings for the Node version of Planszowkarz (see node-app/.env.example). Made by convert-env.sh."
    echo "NODE_ENV=production"
    echo "HOST=::"
    echo "PORT=$PORT"
    echo "TZ=Europe/Warsaw"
    echo "LOG_LEVEL=info"
    echo "PUBLIC_URL=https://planszowkarz.toadres.pl"
    echo "DATABASE_PATH=/opt/planszowkarz/data/planszowkarz.db"
    # Same folder the .NET app wrote feedback to, so pull-feedback.ps1 keeps working.
    echo "FEEDBACK_DIR=/opt/planszowkarz/app/Claude_Resources/Feedback"
    echo "APP_SECRET=$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')"
    # The Node app wants all three or none. The Owner already exists in the migrated database, so when the password
    # was removed from the .NET file after its first start, none are written (the seeder then just leaves the Owner be).
    if [ -n "$(get Admin__UserName)" ] && [ -n "$(get Admin__Email)" ] && [ -n "$(get Admin__Password)" ]; then
        echo "ADMIN_USER_NAME=$(get Admin__UserName)"
        echo "ADMIN_EMAIL=$(get Admin__Email)"
        echo "ADMIN_PASSWORD=$(get Admin__Password)"
    fi
    echo "EMAIL_HOST=$(get Email__Host)"
    echo "EMAIL_PORT=$(get Email__Port)"
    echo "EMAIL_SECURITY=$(security)"
    echo "EMAIL_USER=$(get Email__UserName)"
    echo "EMAIL_PASSWORD=$(get Email__Password)"
    echo "EMAIL_FROM_ADDRESS=$(get Email__FromAddress)"
    echo "BGG_TOKEN=$(get Bgg__Token)"
    # The live .NET app imports the Google sign-up sheet (appsettings.json SheetImport:Enabled = true).
    echo "SHEET_IMPORT_ENABLED=true"
} > "$DST"

# Drop settings that came out empty, so the app's own defaults apply (e.g. EMAIL_PORT, EMAIL_FROM_NAME).
sed -i -E '/^[A-Z_]+=$/d' "$DST"
chmod 600 "$DST"
