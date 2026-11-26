#!/usr/bin/env bash
# Nightly MongoDB backup: an independent copy outside Atlas.
#
#   bash scripts/backup-mongo.sh            # run by hand
#   crontab: 30 21 * * * bash /home/ubuntu/edgecipline/backend/scripts/backup-mongo.sh >> /home/ubuntu/backups/backup.log 2>&1
#            (21:30 UTC = 03:00 IST)
#
# Needs: mongodump (sudo apt install mongodb-database-tools)
# Optional: rclone remote named by BACKUP_RCLONE_REMOTE (e.g. "gdrive:edgecipline-backups")
#           to copy each dump off the server.
#
# Restore test (into a throwaway db, never the live one):
#   mongorestore --uri "<uri>" --gzip --archive=FILE --nsFrom='<db>.*' --nsTo='restoretest.*'

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/mongo}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

# Read only the URI lines. Sourcing .env would break on special characters.
read_env() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | sed -E 's/^["'\'']//; s/["'\'']$//'
}

# Same precedence as config/index.js: MONGO_URI_LOCAL wins over MONGO_URI.
URI="${MONGO_URI_LOCAL:-$(read_env MONGO_URI_LOCAL)}"
URI="${URI:-${MONGO_URI:-$(read_env MONGO_URI)}}"
if [ -z "$URI" ]; then
  echo "$(date -Is) ERROR: no MONGO_URI found in env or $ENV_FILE" >&2
  exit 1
fi

command -v mongodump >/dev/null || { echo "$(date -Is) ERROR: mongodump not installed" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
FILE="$BACKUP_DIR/edgecipline-$(date +%F-%H%M).gz"
TMP="$FILE.partial"

# Write to .partial first so a crashed dump never looks like a good backup.
mongodump --uri="$URI" --gzip --archive="$TMP" --quiet
mv "$TMP" "$FILE"
chmod 600 "$FILE"

SIZE=$(du -h "$FILE" | cut -f1)
echo "$(date -Is) OK: $FILE ($SIZE)"

if [ -n "${BACKUP_RCLONE_REMOTE:-$(read_env BACKUP_RCLONE_REMOTE)}" ]; then
  REMOTE="${BACKUP_RCLONE_REMOTE:-$(read_env BACKUP_RCLONE_REMOTE)}"
  rclone copy "$FILE" "$REMOTE" && echo "$(date -Is) OK: copied to $REMOTE"
fi

find "$BACKUP_DIR" -name 'edgecipline-*.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name '*.partial' -mtime +1 -delete
