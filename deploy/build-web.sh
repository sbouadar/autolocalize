#!/bin/sh
# Construit l'application web (export Expo) dans un conteneur Node et la publie dans /var/www/autolocalize.
# Node n'est pas installé sur le VPS : tout se passe dans un conteneur jetable, à partir du code commité
# (git archive : ni .env, ni node_modules du dépôt). Publication atomique, ancienne version gardée en .old.
#
# Usage (sur le VPS, en root, après git pull) : sh /opt/autolocalize/deploy/build-web.sh
set -eu

REPO=/opt/autolocalize
OUT=/var/www/autolocalize
NEW="$OUT.new"

rm -rf "$NEW"
mkdir -p "$NEW"

docker run --rm -v "$REPO":/src:ro -v "$NEW":/out node:24 sh -c '
  set -e
  git config --global --add safe.directory /src
  mkdir /build
  git -C /src archive HEAD | tar -x -C /build
  cd /build
  npm ci --no-audit --no-fund
  npm run build:web --workspace @autolocalize/app
  cp -r apps/app/dist/. /out/
'

test -f "$NEW/index.html"
rm -rf "$OUT.old"
if [ -d "$OUT" ]; then mv "$OUT" "$OUT.old"; fi
mv "$NEW" "$OUT"
# SELinux : contexte httpd_sys_content_t pour que Nginx puisse lire les fichiers.
restorecon -R "$OUT" 2>/dev/null || true
echo "Application web publiée dans $OUT"
