#!/bin/sh
# Déploie en production le dernier commit de main : API (Docker Compose) puis application web.
# Seule commande que l'utilisateur « deploy » peut lancer en root (voir /etc/sudoers.d/autolocalize-deploy) :
#   ssh autolocalize-vps sudo /usr/bin/sh /opt/autolocalize/deploy/deploy.sh
# Ne touche ni à Nginx ni à traccar.xml. Les migrations Prisma s'appliquent au démarrage du conteneur.
set -eu

export HOME=/root
REPO=/opt/autolocalize
cd "$REPO"

BEFORE=$(git rev-parse --short HEAD)
git pull --ff-only
AFTER=$(git rev-parse --short HEAD)
echo "Commit : $BEFORE -> $AFTER"

docker compose up -d --build

# L'API applique les migrations avant d'écouter : on lui laisse jusqu'à 2 minutes.
i=0
until curl -fsS -o /dev/null http://127.0.0.1:3000/api/health; do
  i=$((i + 1))
  if [ "$i" -ge 40 ]; then
    echo "ECHEC : /api/health ne répond pas" >&2
    docker compose logs --tail 40 api >&2
    exit 1
  fi
  sleep 3
done
echo "API : /api/health OK"

sh "$REPO/deploy/build-web.sh"

echo "DEPLOIEMENT OK : $(git log --oneline -1)"
