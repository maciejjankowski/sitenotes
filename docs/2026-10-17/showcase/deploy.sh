#!/usr/bin/env bash
# Publish the showcase to its own vhost. SN_SSH and SN_SHOWCASE_HOST come from .secrets/deploy.env.
# notes.js is referenced as notes.js?v=<hash of the file>, so a browser never keeps an old copy after a deploy.
set -euo pipefail
cd "$(dirname "$0")"; . ../../../.secrets/deploy.env
V=$(md5 -q notes.js 2>/dev/null || md5sum notes.js | cut -c1-32); V=${V:0:10}
S=$(mktemp -d); rsync -rL --exclude=deploy.sh ./ "$S/"
sed -i '' -e "s#src=\"notes.js\"#src=\"notes.js?v=$V\"#" "$S/index.html"
sed -i '' -e "s#src=\"../notes.js\"#src=\"../notes.js?v=$V\"#" "$S/en/index.html"
printf '<Files "notes.js">\n  Header set Cache-Control "no-cache, must-revalidate"\n</Files>\n' > "$S/.htaccess"
rsync -rptz --delete -e "ssh -o BatchMode=yes" "$S/" "$SN_SSH:domains/$SN_SHOWCASE_HOST/public_html/"
rm -rf "$S"
echo "https://$SN_SHOWCASE_HOST/  http $(curl -s -o /dev/null -w '%{http_code}' "https://$SN_SHOWCASE_HOST/")  notes.js?v=$V"
