#!/usr/bin/env bash
# Build the F1 site and upload it to the EC2 server that runs login-app.
# Caddy there serves ./f1-site at https://f1.<login-app domain>.
#
#   KEY=~/path/to/key.pem ./deploy-f1.sh
#   KEY=... HOST=ec2-user@1.2.3.4 ./deploy-f1.sh     # different server
#   SKIP_BUILD=1 KEY=... ./deploy-f1.sh              # upload existing dist/
#
# Needs: the login-app aws-ec2-deploy branch (with the F1 Caddy block)
# deployed on the server once via ./deploy.sh.
set -euo pipefail
cd "$(dirname "$0")"

: "${KEY:?Set KEY to your EC2 .pem key path}"
HOST=${HOST:-ec2-user@15.135.155.180}
REMOTE_DIR=${REMOTE_DIR:-login-app/f1-site}
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"

if [ -z "${SKIP_BUILD:-}" ]; then
  echo "==> Exporting data and building"
  (cd frontend && npm run data && npm run build)
fi

echo "==> Uploading frontend/dist to $HOST:~/$REMOTE_DIR"
# Docker creates a missing bind-mount folder as root; take it back if so.
$SSH "$HOST" "mkdir -p ~/$REMOTE_DIR 2>/dev/null; [ -w ~/$REMOTE_DIR ] || sudo chown \$(id -u):\$(id -g) ~/$REMOTE_DIR"
rsync -az --delete -e "$SSH" frontend/dist/ "$HOST:~/$REMOTE_DIR/"

DOMAIN=$($SSH "$HOST" "sed -n 's/^DOMAIN=//p' ~/login-app/.env | tail -1")
echo "==> Done: https://f1.$DOMAIN"
