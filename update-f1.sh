#!/usr/bin/env bash
# Run after each Grand Prix: pull the new race into data/f1.db, then rebuild
# the site and deploy it to the login-app EC2 server.
#
#   ./update-f1.sh              # update + deploy
#   ./update-f1.sh --no-deploy  # update the database only
#   ./update-f1.sh --force      # deploy even if no new race was found
#
# Uses LA_PEM / LA_HOST from ~/.zshrc (override with KEY=... HOST=...).
set -euo pipefail
cd "$(dirname "$0")"

DEPLOY=1 FORCE=0
for arg in "$@"; do
  case "$arg" in
    --no-deploy) DEPLOY=0 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 1 ;;
  esac
done

KEY=${KEY:-${LA_PEM:-}}
HOST=${HOST:-${LA_HOST:-ec2-user@15.135.155.180}}
if [ "$DEPLOY" = 1 ] && [ ! -f "${KEY:-/nonexistent}" ]; then
  echo "SSH key not found. Set KEY=/path/to/key.pem (or LA_PEM in ~/.zshrc)." >&2
  exit 1
fi

DB=data/f1.db
latest_race() {
  python3 - "$DB" <<'EOF'
import sqlite3, sys
row = sqlite3.connect(sys.argv[1]).execute("""
    SELECT r.season, r.round, r.race_name FROM races r
    WHERE EXISTS (SELECT 1 FROM race_results x WHERE x.season = r.season AND x.round = r.round)
    ORDER BY r.season DESC, r.round DESC LIMIT 1""").fetchone()
print(f"{row[0]} R{row[1]} {row[2]}" if row else "none")
EOF
}

BEFORE=$(latest_race)
echo "==> Latest race in database: $BEFORE"

# Keep the previous database in case the scrape goes wrong.
cp "$DB" data/f1.backup-latest.db
echo "==> Fetching new race data (pauses with HTTP 429 are normal)"
if ! python3 scraper/scrape.py --refresh; then
  echo "Scrape failed. Restoring the previous database from data/f1.backup-latest.db." >&2
  cp data/f1.backup-latest.db "$DB"
  exit 1
fi

AFTER=$(latest_race)
if [ "$AFTER" = "$BEFORE" ]; then
  echo "==> No new race results yet (still $AFTER)."
  if [ "$FORCE" = 0 ]; then
    echo "    Results usually appear a few hours after the race. Use --force to deploy anyway."
    exit 0
  fi
else
  echo "==> New race added: $AFTER"
fi

if [ "$DEPLOY" = 0 ]; then
  echo "==> Database updated; skipping deploy (--no-deploy)."
  exit 0
fi

# Exports JSON from the database, builds the site and uploads it.
KEY="$KEY" HOST="$HOST" ./deploy-f1.sh
