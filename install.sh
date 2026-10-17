#!/usr/bin/env bash
# One-time setup for Site Notes (browser extension + hub). Safe to re-run: keeps the existing key.
#   ./install.sh [HUB_URL]     default http://localhost:18080/annot (QA server in claude-vm)
# Writes .secrets/hub.env (bin/annot), hub/secret.php (hub) and extension/defaults.js (extension),
# all git-ignored, and links hub/ into ~/code/qa-www/annot.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .secrets/hub.env ] && . .secrets/hub.env
HUB="${1:-${SN_HUB:-http://localhost:18080/annot}}"
KEY="${SN_KEY:-$(openssl rand -hex 16)}"
mkdir -p .secrets hub/data/shots
umask 077
printf 'SN_HUB=%s\nSN_KEY=%s\n' "$HUB" "$KEY" > .secrets/hub.env
printf "<?php\nconst SN_KEY = '%s';\n" "$KEY" > hub/secret.php
printf "self.SN_DEFAULTS = { hub: '%s', key: '%s' };\n" "$HUB" "$KEY" > extension/defaults.js
chmod 644 hub/secret.php extension/defaults.js
chmod 775 hub/data hub/data/shots
[ -d "$HOME/code/qa-www" ] && ln -sfn "$PWD/hub" "$HOME/code/qa-www/annot"
echo "hub:       $HUB/   (first visit: $HUB/?key=$KEY)"
echo "extension: chrome://extensions > Developer mode > Load unpacked > $PWD/extension"
echo "agent:     $PWD/bin/annot sites"
