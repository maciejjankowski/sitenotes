#!/usr/bin/env bash
# Publish the showcase (this folder, symlinks dereferenced) to its own vhost. SN_SSH and SN_SHOWCASE_HOST come from .secrets/deploy.env.
set -euo pipefail
cd "$(dirname "$0")"; . ../../../.secrets/deploy.env
rsync -rLptz --delete --exclude=deploy.sh -e "ssh -o BatchMode=yes" ./ "$SN_SSH:domains/$SN_SHOWCASE_HOST/public_html/"
echo "https://$SN_SHOWCASE_HOST/  http $(curl -s -o /dev/null -w '%{http_code}' "https://$SN_SHOWCASE_HOST/")"
