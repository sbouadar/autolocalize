# CLAUDE.md — Service de suivi GPS (Traccar)

Projet de service de suivi GPS de véhicules à commercialiser, construit au-dessus d'une instance Traccar auto-hébergée.

## Consignes de travail

- Répondre en français.
- Avant de donner des commandes ou des versions précises (paquets, images Docker, bibliothèques), vérifier qu'elles sont à jour.
- Poser une seule question à la fois quand une précision est nécessaire.
- Ne jamais lire, afficher ni committer `passwords.txt` ni aucun secret (clé du compte de service Traccar, mots de passe de base, `.env`).
- Mettre à jour ce fichier dès qu'une décision est prise ou qu'un état de l'infrastructure change (section « État de l'infrastructure »).

## Dépôt

- GitHub privé : `git@github.com:sbouadar/autolocalize.git`, branche `main`. Dépôt git dédié à ce dossier (distinct du dépôt parent `Documents/perso`).
- Accès SSH depuis WSL via `~/.ssh/id_ed25519_github` (déclaré dans `~/.ssh/config`).
- `git push` est fait par l'utilisateur (non autorisé pour Claude) : lui donner la commande.

## Projet backend (`apps/api`)

Monorepo npm workspaces (`apps/*`). Node **24 LTS** (via nvm : `source ~/.nvm/nvm.sh && nvm use 24` ; Node 20 est en fin de vie et son npm plante sur les dépendances de Better Auth). npm 11.19+ bloque les scripts d'installation : ceux autorisés sont listés dans `allowScripts` du `package.json` racine.

Versions figées (vérifiées le 2026-10-27) : Fastify 5.12.7, Better Auth 1.7.14, Prisma 7.10.1 (la balise `latest` de npm pointe sur une RC 8.0 non supportée par Better Auth : rester en 7.x), `@prisma/adapter-mariadb` 7.10.1, Zod 4.6.7, TypeScript 7.0.2, tsx 4.23.15.

```
apps/api/
  prisma/schema.prisma        schéma (tables applicatives + tables Better Auth)
  prisma/migrations/          migrations SQL versionnées
  prisma.config.ts            config Prisma 7 (URL de la base, charge .env)
  src/scripts/seed.ts         super-admin + client « demo » + traceur GPS1 (idempotent)
  src/config.ts               variables d'environnement validées par Zod
  src/lib/prisma.ts           client Prisma (adaptateur mariadb, compatible MySQL)
  src/lib/auth.ts             Better Auth (email/mot de passe, inscription désactivée, 2FA, bearer)
  src/lib/traccar.ts          client REST Traccar (jeton du compte de service)
  src/plugins/auth-context.ts requireAuth / requireRole, contrôle du statut du tenant
  src/routes/*.ts             health, auth (relais Better Auth), public, me, vehicles
  Dockerfile                  image de prod (build depuis la racine du dépôt)
docker-compose.yml            prod sur le VPS (network_mode: host)
docker-compose.dev.yml        MariaDB 10.5 locale pour le dev (même version que le VPS)
```

Routes (préfixe `/api`) : `GET /health`, `/auth/*` (Better Auth : `POST /auth/sign-in/email`, `POST /auth/sign-out`, `GET /auth/get-session`, 2FA…), `GET /public/tenants/:slug/branding`, `GET /me`, `GET /vehicles`.

Commandes (depuis `apps/api`, Node 24 actif) :
- `docker compose -f ../../docker-compose.dev.yml up -d` : MariaDB de dev (service `db`)
- `npm run prisma:migrate -- --name <nom>` : nouvelle migration (Prisma 7 ne régénère plus le client tout seul : le script enchaîne `prisma generate`)
- `npm run seed` (variables `SEED_*`, voir l'en-tête de `src/scripts/seed.ts`) ; en prod : `docker compose exec -e SEED_…=… api node dist/scripts/seed.js`
- `npm run dev` : serveur en rechargement auto ; `npm run typecheck`
- En local, le port 3000 est déjà pris par une autre application : le `.env` de dev utilise **3100**.

Points de conception :
- Rôles : `SUPER_ADMIN` (sans tenant), `TENANT_ADMIN`, `VIEWER`. Pas de plugin « organization » de Better Auth : un utilisateur appartient à un seul tenant (`user.tenantId`), c'est plus simple.
- `requireAuth` relit rôle et tenant en base à chaque requête ; tenant non `ACTIVE` → 403.
- Comptes créés par admin uniquement (`disableSignUp`) ; le seed écrit le hash Better Auth dans `account` (`providerId = "credential"`).
- `GET /vehicles` : liste issue de notre base (filtrée par tenant), enrichie par Traccar (`/api/devices?all=true` en cache 5 s, puis `/api/positions?id=…`). Piège Traccar : `/api/devices?id=…` applique les rattachements même pour un admin (renvoie vide pour `bff-service`) ; `all=true` et `/api/positions?id=…` passent pour un admin. Si Traccar est injoignable, renvoie la liste avec `liveDataAvailable: false`.
- Les 5xx ne renvoient jamais le message interne ; cookies et en-tête `Authorization` masqués dans les logs.
- Image Docker ~770 Mo : à optimiser plus tard.

## État de l'infrastructure (au 2026-10-27)

- VPS : **Rocky Linux 9.8** (famille RHEL : `dnf`, `firewalld`, SELinux). Paquets tiers via EPEL.
- Base : **MariaDB 10.5.29** (pas MySQL), écoute sur `*:3306` mais port fermé par firewalld et IONOS (à passer en `bind-address=127.0.0.1`). Port 3000 libre (réservé au backend). Pas de Podman. **Docker 29.9.2 + Compose 5.6.1** installés (dépôt officiel `docker-ce`, 2026-10-27). Administration du VPS en root.
- Domaine : `autolocalize.net` → A `217.160.33.233` (VPS IONOS). Pas d'AAAA, pas d'enregistrement `www`.
- Traccar **6.14.2** exposé en HTTP direct sur `http://autolocalize.net:8082/` (dernière version publiée : 6.16.0). Fuseau du serveur : `Africa/Casablanca`.
- Pare-feu IONOS (« My firewall policy ») : seulement TCP 22, 80, 443, 5023 (gt06) autorisés pour tous (8082, 8443, 8447 supprimés le 2026-10-27).
- firewalld actif (zone `public`, eth0) : services `cockpit dhcpv6-client ssh`, ports `8082/tcp 5055/tcp 5023/tcp`. 5055 (OsmAnd) ouvert côté système mais pas côté IONOS.
- firewalld : services `http` et `https` ajoutés (2026-10-27).
- **Nginx 1.26.3** (flux de module `nginx:1.26`) en reverse proxy : `/etc/nginx/conf.d/autolocalize.conf`, `server_name autolocalize.net` → `http://127.0.0.1:8082`, en-têtes WebSocket via `map $http_upgrade $connection_upgrade`. `httpd_can_network_connect=1`. `http://autolocalize.net/` sert bien Traccar (vérifié).
- SELinux : **Enforcing** (garder ainsi ; Nginx → Traccar exige `httpd_can_network_connect=1`).
- Sur le VPS, seul Traccar (java) écoute : `*:8082` (web) et `*:5023` (gt06). Rien sur 80, 443, 8443, 8447 → les règles IONOS 8443 et 8447 sont inutiles et pourront être supprimées.
- **HTTPS opérationnel** (2026-10-27) : `https://autolocalize.net/` → Traccar, certificat Let's Encrypt (`/etc/letsencrypt/live/autolocalize.net/`, émetteur YE1, expire le 2027-01-25), HTTP → HTTPS en 301. Certbot 3.1.0 (EPEL + CRB, plugin `python3-certbot-nginx`), renouvellement par `certbot-renew.timer`, `renew --dry-run` OK.
- Interface web Traccar restreinte à `127.0.0.1:8082` (`web.address` dans `/opt/traccar/conf/traccar.xml`, sauvegarde `traccar.xml.bak-2026-10-27`) : 8082 n'est plus joignable de l'extérieur (vérifié), seul Nginx y accède. Port traceurs `*:5023` inchangé.
- À confirmer : 8082 retiré de firewalld.
- `www.autolocalize.net` : volontairement non configuré (pas jugé utile).
- **Backend déployé** (2026-10-27) : dépôt cloné dans `/opt/autolocalize` (clé de déploiement GitHub en lecture seule `/root/.ssh/autolocalize_deploy`, hôte SSH `github-autolocalize`). Base MariaDB `autolocalize`, utilisateur `autolocalize`@`127.0.0.1`/`localhost`. Secrets dans `/opt/autolocalize/apps/api/.env` (chmod 600). Conteneur `docker compose up -d --build` → `127.0.0.1:3000`, migration `init` appliquée, `/api/health` OK. Mise à jour : `cd /opt/autolocalize && git pull && docker compose up -d --build`. Comptes créés par le seed : super-admin `s.bouadar@gmail.com`, client `demo` (« Démo Transport ») avec admin `demo@autolocalize.net` (compte de démo pour Apple/Google), GPS1 rattaché.
- **Nginx `autolocalize.net`** (2026-10-27) : config versionnée `deploy/nginx/autolocalize.conf` copiée dans `/etc/nginx/conf.d/` (ancienne sauvegardée dans `/root/autolocalize.conf.bak-2026-10-27`). `/api/` → backend `127.0.0.1:3000` (vérifié de l'extérieur : health, branding, 401 sur `/me`) ; `/` → 302 vers `traccar.autolocalize.net` en attendant l'app web. Traccar n'est plus servi sur `autolocalize.net`. `certbot renew --dry-run` OK avec cette config.
- Coller des commandes multi-lignes indentées dans le terminal SSH de l'utilisateur échoue (heredoc non fermé, lignes ignorées) : donner une commande par bloc, sans heredoc, ou passer par des fichiers versionnés dans `deploy/`.
- `https://traccar.autolocalize.net/` opérationnel (2026-10-27) : A → 217.160.33.233, `/etc/nginx/conf.d/traccar.conf` → `127.0.0.1:8082`, certificat Let's Encrypt dédié (expire le 2027-01-25, renouvellement automatique), HTTP → HTTPS. Traccar reste aussi servi sur `autolocalize.net` tant que l'application client n'y est pas déployée ; à basculer ensuite (et utiliser `traccar.autolocalize.net` comme URL Traccar du backend).
- Traccar renvoie la trace Java complète sur les 404 de l'API (ex. `/api/inexistant`) : à masquer (`web.debug`, ou `proxy_intercept_errors` dans Nginx sur `traccar.autolocalize.net`).
- Plus tard : mettre à jour Traccar (6.14.2 → 6.16.0) ; certificat wildcard `*.autolocalize.net` (validation DNS IONOS) quand il y aura un sous-domaine par client.

## 1. Contexte

- Développeur et administrateur système, basé en France.
- Serveur Traccar auto-hébergé sur un VPS IONOS (pas de cPanel ni de panneau d'hébergement), MySQL déjà installé.
- Nom de domaine rattaché à une offre d'hébergement web IONOS, pointé vers l'IP du VPS.
- Les traceurs envoient leurs données en TCP brut vers le VPS (port 5023 pour le mien).
- Concurrent analysé : gpsglcar.com — plateforme propriétaire chinoise en marque blanche (ASP.NET, menu System / Management / Config / Control / Report / Main Track / Live Track / Replay). Ce n'est pas du Traccar.

## 2. Objectif

- Commercialiser du suivi de véhicules : 10 clients au départ, 100 à 150 visés.
- Chaque client ne voit que ses propres véhicules.
- Fonctions : suivi en direct, historique des trajets, statistiques d'usage, dashboard KPI sur smartphone, coupure et rétablissement du moteur à distance, notifications.
- Chaque client voit le logo, le nom et l'adresse de sa société, comme sur un site dédié.
- L'admin de chaque client modifie son logo et ses informations depuis un back-office.

## 3. Décisions déjà prises

- **Une seule instance Traccar** pour tous les clients, avec une couche développée au-dessus (plusieurs instances ne sont pas viables à 150 clients).
- **Pas de PHP** : pile moderne, légère, sûre, en **TypeScript**, facilement transformable en application Android et iPhone. Vercel est une option pour le front web.
- **Une seule application mobile** dans les stores pour tous les clients. Le branding (logo, nom, couleurs, adresse) s'affiche après la connexion. Pas d'application distincte par client.

## 4. HTTPS et réseau

- Nginx en reverse proxy devant Traccar, certificat Let's Encrypt via Certbot ; wildcard `*.mondomaine.com` par validation DNS si un sous-domaine par client.
- Enregistrement DNS A du sous-domaine vers l'IP du VPS ; ports 80, 443 et 5023 (traceurs) ouverts dans le pare-feu IONOS et le pare-feu système.
- En-têtes `Upgrade` et `Connection` obligatoires dans Nginx pour les WebSockets de Traccar (suivi en direct).
- Dans `traccar.xml`, interface web sur `127.0.0.1` : le port 8082 n'est joignable que par Nginx.
- Les traceurs envoient en TCP brut vers l'IP et le port 5023, sans passer par Nginx.

## 5. Limites de Traccar

- Branding natif (logo, nom du serveur, description, couleurs) **global à l'instance**, pas par utilisateur. Pas de champ « adresse de la société ».
- Pas de facturation intégrée.
- `engineStop` / `engineResume` ne fonctionnent que si le modèle de traceur les supporte pour son protocole et s'il est câblé sur un relais. Impossible de démarrer un véhicule à distance (seulement couper puis rétablir). Beaucoup de traceurs n'exécutent la coupure que sous un seuil de vitesse.
- Champs d'expiration par utilisateur et par appareil, et un appareil peut être désactivé : utile pour les impayés.

## 6. Architecture

- **Application client** : Expo (React Native + TypeScript) avec export web — un seul code pour Android, iOS et web, notifications push natives. Alternative : PWA Next.js (moins de notifications possibles sur iPhone).
- **Backend (BFF)** : Node.js + TypeScript (Fastify ou Hono), dans Docker sur le VPS, derrière Nginx.
  - Seul à connaître le compte de service Traccar. Les applications ne parlent **jamais** à Traccar directement.
  - À chaque requête, vérifie que le véhicule appartient au client connecté.
  - Commandes moteur : rôle autorisé, confirmation, journal d'audit, limitation de fréquence, refus si la dernière vitesse connue est trop élevée.
  - KPI calculés depuis les rapports Traccar (trajets, arrêts, distance, vitesse max, heures moteur), avec cache.
- **Base de l'application** : base MySQL séparée (utilisateur dédié) au départ ; PostgreSQL possible.
- **Authentification** : solution éprouvée (Clerk, Supabase Auth ou Better Auth), mots de passe hachés, double authentification.
- **Temps réel et alertes** : le backend écoute Traccar (WebSocket ou transfert d'événements par webhook) et relaie vers les applications ; push via Expo Push ou Firebase Cloud Messaging.
- **Vercel** : seulement front web et page de connexion. Traccar et ses ports TCP restent sur le VPS (le serverless ne convient pas aux WebSockets longues). Région européenne (RGPD).
- Pas de permission de localisation du téléphone : l'app affiche la position des véhicules fournie par le serveur.
- Stores : compte de démonstration pour la validation Apple et Google, description claire de la commande moteur dans les notes de soumission, vérifier la règle Apple sur la suppression de compte.

## 7. Modèle de données (base de l'application)

- `tenants` : nom, adresse, téléphone, logo, couleurs, statut d'abonnement
- `users` : tenant, rôle (admin client, lecture seule), lien vers l'utilisateur Traccar
- `vehicles` : tenant, identifiant d'appareil Traccar, nom, plaque
- `command_log` : qui, quand, quel véhicule, quelle commande, résultat
- `push_tokens` : utilisateur, jeton de notification, plateforme

## 8. Points d'API principaux

- `POST /auth/login`, `GET /me` (utilisateur et branding du client)
- `GET /vehicles`, `GET /vehicles/:id/position`
- `GET /vehicles/:id/trips`, `GET /dashboard/kpis`
- `POST /vehicles/:id/commands` (coupure et rétablissement, avec journal)
- `PUT /tenant/branding` (réservé à l'admin du client)

## 9. Ordre de développement

1. Backend avec authentification, tenants et liste des véhicules.
2. Carte en direct et fiche véhicule dans l'application.
3. KPI et historique des trajets.
4. Commandes moteur avec journal d'audit.
5. Notifications push et branding modifiable par l'admin client.

## 10. Points de vigilance

- **Juridique** : la position d'un véhicule est une donnée personnelle dès qu'elle peut être reliée à un conducteur. Contrat avec chaque client, information des conducteurs, durées de conservation raisonnables. RGPD et CNIL en France ; loi 09-08 et CNDP au Maroc selon le pays des clients. À faire valider par un juriste.
- **Sécurité** : Traccar à jour, port 8082 non exposé, clé de service jamais côté client, journal d'audit sur les commandes, sauvegardes régulières de la base.

## 11. Plan d'actions — interface personnalisée par client

Phase 0 — Décisions et prérequis
- ~~Fermer l'accès direct à 8082~~ — fait (2026-10-27).
- Compte de service Traccar créé (2026-10-27) : `bff-service` / `bff@autolocalize.net`, admin, expiration 2099, sans attributs. Jeton d'API (Bearer) stocké hors projet, à placer uniquement dans le `.env` du backend sur le VPS. Jeton validé sur `/api/devices?all=true` (un premier jeton divulgué a été révoqué). Le compte n'a aucun appareil rattaché : en tant qu'admin, il accède à tout via l'API.
- Traceurs existants : 1 appareil de test `GPS1` (id 1, IMEI 865190074141964, groupe id 1, en ligne).
- Rattachement client ↔ Traccar : un **groupe Traccar par tenant** ; la table `vehicles` de l'application reste la source de vérité pour l'appartenance.
- Authentification : **Better Auth** retenu (2026-10-27) — bibliothèque TS auto-hébergée, comptes dans notre base, 2FA (plugin two-factor), plugin bearer pour le mobile. Plugin « organization » finalement non utilisé (voir « Projet backend »).
- Framework HTTP : **Fastify** retenu (2026-10-27) — plugins officiels rate-limit, multipart, websocket, helmet, cors ; validation par schéma ; intégration Better Auth.
- ORM / migrations : **Prisma** retenu (2026-10-27), avec l'adaptateur Prisma de Better Auth. Vérifier la version courante et ses exigences (configuration, adaptateur de pilote MySQL) avant d'écrire le code.
- Branding (2026-10-27) : **un seul domaine**, pas de sous-domaine par client. Branding complet chargé après connexion (`GET /me`). Sur le web, page de connexion personnalisable via `https://autolocalize.net/login/<slug>` (ex. `/login/client1`) : endpoint public `GET /public/tenants/:slug/branding` qui ne renvoie que nom, logo, couleurs (404 générique si slug inconnu). `/login` sans slug = page à la marque AutoLocalize. App mobile : branding après connexion uniquement. Pas de wildcard nécessaire.
- Répartition des URL (**validée** le 2026-10-27) : `autolocalize.net` = application web client ; `autolocalize.net/api/` = backend (même origine : pas de CORS, cookies de session first-party) ; Traccar déplacé vers `traccar.autolocalize.net` (enregistrement A + certificat), réservé à l'admin. Conflit sinon : Traccar occupe aujourd'hui `/` et `/api`.

Phase 1 — Socle backend : monorepo, Docker, schéma SQL et migrations, auth, `GET /me` (utilisateur + branding), `GET /vehicles` filtré par tenant et enrichi des positions Traccar, déploiement derrière Nginx.

Phase 2 — Back-office : super-admin (création des tenants, affectation des traceurs) et admin client (logo, nom, adresse, téléphone, couleurs via `PUT /tenant/branding`, stockage des logos).

Phase 3 — Application Expo : connexion, thème dynamique depuis `/me`, carte en direct, fiche véhicule.

Ensuite : KPI et trajets, commandes moteur, notifications push (cf. section 9).

## 12. Étape en cours

**Phase 1 terminée** (2026-10-27) : backend déployé en production sur `https://autolocalize.net/api/`, testé de bout en bout (connexion du compte démo, `/vehicles` renvoie GPS1 en ligne avec sa position réelle).

Petits restes d'infra : MariaDB en `bind-address=127.0.0.1` ; masquer les traces Java de Traccar ; mise à jour Traccar 6.16.0.

Prochaine étape à choisir : phase 2 (back-office : super-admin + branding modifiable) ou phase 3 (application Expo : connexion, thème, carte).
