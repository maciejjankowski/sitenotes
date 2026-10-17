#!/usr/bin/env bash
# After a change in extension/content.js or hub/: push the hub + notes.js to every site that has its own hub
# (or only the sites named: ./update-sites.sh example.com other.example).
# Copies into each site's repo (WEBROOT/notes/, shipped later by that site's own deploy) and uploads notes/ only
# (never data/ or the key). Sites come from .secrets/sites/*.env (SN_WEBROOT written by install-site.sh).
set -euo pipefail
cd "$(dirname "$0")"
. .secrets/deploy.env  # SN_SSH=user@host, SN_DEMO_HOSTS="host1 host2"
sites=("$@"); [ ${#sites[@]} -gt 0 ] || sites=($(cd .secrets/sites && ls *.env | sed "s/\.env$//"))
for d in "${sites[@]}"; do
  f=".secrets/sites/$d.env"; [ -f "$f" ] || { echo "$d: no $f, skipped"; continue; }
  (
    . "$f"; d="$(basename "$f" .env)"
    [ -n "${SN_WEBROOT:-}" ] || { echo "$d: no SN_WEBROOT in $f, skipped"; exit 0; }
    cp hub/api.php hub/lib.php hub/index.php hub/.htaccess "$SN_WEBROOT/notes/"
    cp extension/content.js "$SN_WEBROOT/notes/notes.js"
    rsync -rlptz --exclude=data/ --exclude=secret.php -e "ssh -o BatchMode=yes" "$SN_WEBROOT/notes/" "$SN_SSH:domains/$d/public_html/notes/"
    if curl -fs "https://$d/notes/notes.js" 2>/dev/null | cmp -s - extension/content.js; then echo "$d: live notes.js matches"; else echo "$d: uploaded, live copy not confirmed"; fi
  )
done
# demo hosts embed notes.js with ?v=<mtime of _notes_append.php>: bump it so phones fetch the new script
for host in ${SN_DEMO_HOSTS:-}; do
  ssh -o BatchMode=yes "$SN_SSH" "touch domains/$host/public_html/_notes_append.php" && echo "$host: version bumped"
done
