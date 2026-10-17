#!/usr/bin/env bash
# Put Site Notes on a site hosted on MyDevil, replacing the old annotator.js. Safe to re-run.
#   ./install-site.sh DOMAIN WEBROOT        e.g. ./install-site.sh example.com ~/code/example.com
# WEBROOT = the repo folder that becomes the site root (Jekyll source, or a static folder).
#  1. copies the hub + notes.js into WEBROOT/notes/ and turns WEBROOT/assets/js/annotator.js into a loader
#     for /notes/notes.js, so the site's own deploy ships them from now on
#  2. server: notes/secret.php with the site's existing annotator key (old #annot= links and browsers keep working)
#  3. uploads ONLY notes/ and the loader (no rebuild, nothing else from the repo goes live)
#  4. copies the old notes into the new hub (tools/migrate_annotator.php)
#  5. writes .secrets/sites/DOMAIN.env for bin/annot
# The site's deploy must exclude notes/data/ and notes/secret.php (rsync --delete); this script warns if not.
set -euo pipefail
DOMAIN="${1:?usage: install-site.sh DOMAIN WEBROOT}"; WEB="$(cd "${2:?usage: install-site.sh DOMAIN WEBROOT}" && pwd)"
cd "$(dirname "$0")"
. "$(dirname "$0")/.secrets/deploy.env"; HOST="$SN_SSH"; R="domains/$DOMAIN/public_html"  # SN_SSH=user@host in .secrets/deploy.env
SSH=(ssh -o BatchMode=yes "$HOST")

echo "== $DOMAIN: files into $WEB/notes/"
mkdir -p "$WEB/notes/data" "$WEB/assets/js"
cp hub/api.php hub/lib.php hub/index.php hub/.htaccess "$WEB/notes/"
cp hub/data/.htaccess "$WEB/notes/data/.htaccess"
cp extension/content.js "$WEB/notes/notes.js"
cat > "$WEB/assets/js/annotator.js" <<'JS'
// The old review script is retired. This file only loads Site Notes (/notes/: hub + notes.js),
// so pages that still include annotator.js need no rebuild. Wakes with #notes=KEY (old #annot=KEY links work).
(function () {
  var s = document.createElement('script');
  s.src = '/notes/notes.js';
  s.setAttribute('data-site-notes', '');
  document.head.appendChild(s);
})();
JS

echo "== key"
mkdir -p .secrets/sites
KEY="$("${SSH[@]}" "php -r 'if (is_file(\"$R/notes/secret.php\")) { include \"$R/notes/secret.php\"; echo SN_KEY; } elseif (is_file(\"$R/annotations/secret.php\")) { include \"$R/annotations/secret.php\"; echo ANNOT_KEY; }'" || true)"
if [ -z "$KEY" ]; then KEY="$(openssl rand -hex 16)"; echo "   no old key on the server, made a new one"; else echo "   reusing the site's key"; fi
"${SSH[@]}" "mkdir -p $R/notes && umask 022 && cat > $R/notes/secret.php" <<<"<?php
const SN_KEY = '$KEY';"
(umask 077; printf 'SN_HUB=%s\nSN_KEY=%s\nSN_WEBROOT=%s\n' "https://$DOMAIN/notes" "$KEY" "$WEB" > ".secrets/sites/$DOMAIN.env")

echo "== upload notes/ and the loader only"
rsync -rlptz --exclude=data/ --exclude=secret.php -e "ssh -o BatchMode=yes" "$WEB/notes/" "$HOST:$R/notes/"
rsync -ptz -e "ssh -o BatchMode=yes" "$WEB/assets/js/annotator.js" "$HOST:$R/assets/js/annotator.js"

echo "== check"
code=$(curl -s -o /dev/null -w "%{http_code}" -H "X-SN-Key: $KEY" "https://$DOMAIN/notes/api.php?a=sites" || true)
echo "   api with key: $code (want 200)"
for p in notes/api.php notes/secret.php notes/lib.php notes/data/notes.sqlite; do
  echo "   $p without key: $(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/$p" || true) (want 403)"
done
echo "   loader: $(curl -s "https://$DOMAIN/assets/js/annotator.js" | grep -c "/notes/notes.js" || true) (want 1)"

echo "== old notes"
"${SSH[@]}" "cd $R/notes && php -- $DOMAIN" < tools/migrate_annotator.php

grep -rqs 'notes/data' "$(dirname "$WEB")"/*/configs/deploy.conf "$WEB/configs/deploy.conf" "$WEB/scripts/deploy.sh" "$WEB/../deploy.sh" 2>/dev/null \
  || echo "!! add --exclude=notes/data/ and --exclude=notes/secret.php to this site's deploy (rsync --delete)"
echo "== done: https://$DOMAIN/#notes=<key in .secrets/sites/$DOMAIN.env>   agent: bin/annot export $DOMAIN"
