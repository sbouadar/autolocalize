# Plan — fonctions métier (location et gestion de flotte)

Rédigé le 2026-11-21, à la demande de l'utilisateur, pour être suivi par une autre session.
Statut : **plan validé, M1 à M10 déployés ; reste M11.** Les cinq questions ouvertes ont été tranchées par
l'utilisateur le 2026-11-21 (section 6). Les points encore marqués « à confirmer » sont des choix
par défaut : poser la question (une seule à la fois) au début de la tranche concernée.

## 1. Contexte et principes

- Clients visés : **surtout des loueurs de voitures**, avec une diversification possible vers des
  entreprises qui suivent leur propre flotte. Les fonctions de location forment donc un **module
  activable par client** ; entretien, échéances et dépenses servent à tous.
- Tout est livré **par tranches**, chacune testée puis déployée seule selon la règle de `CLAUDE.md`
  (commit, push, `deploy.sh`, contrôles extérieurs, mise à jour de `CLAUDE.md`). Pas d'environnement
  de recette : une tranche ne doit jamais casser l'existant.
- **Migrations additives uniquement** (nouvelles tables, nouvelles colonnes nullables ou avec valeur
  par défaut). Toute migration qui supprime, renomme ou transforme des données exige l'accord de
  l'utilisateur (règle de `CLAUDE.md`). Une seule migration par tranche, nommée d'après elle.
- Notre base fait foi pour tout ce qui est métier. Traccar ne sert qu'aux positions, trajets,
  kilométrage GPS et événements ; rien de métier n'y est écrit.
- Mêmes règles que l'existant : tenant tiré de la session (`requireAuth`), jamais du corps de la
  requête ; ressource d'un autre client → 404 comme une ressource inexistante ; validation Zod
  stricte ; journal `audit_log` pour les écritures sensibles ; 5xx sans message interne.
- Chaque tranche ajoute des tests d'intégration (`apps/api/test`) couvrant au moins : cloisonnement
  entre deux clients, droits par rôle, cas limites métier (chevauchements, dates). Et des tests de
  l'app pour les nouveaux écrans. Les nouveaux écrans utilisent directement le thème de la refonte
  (`src/lib/theme.ts`, `fonts.…`, jamais `fontWeight`).
- Données personnelles (locataires, conducteurs) : minimum nécessaire, pas de scan de pièce
  d'identité dans un premier temps, durée de conservation à faire valider par un juriste (RGPD,
  loi 09-08 / CNDP au Maroc).

## 2. Ordre des tranches

Prérequis : la **tranche 1 de la refonte visuelle** (écrite, non déployée) est vue à l'écran par
l'utilisateur puis déployée avant M1, pour que les nouveaux écrans partent du nouveau thème.

| # | Tranche | Dépend de |
|---|---|---|
| M1 | Socle : modules par client, devise et fuseau, fiche véhicule enrichie, compteur kilométrique, événements internes et tâche planifiée | — |
| M2 | Plusieurs comptes par client et rôle « agent » | M1 |
| M3 | Indisponibilités et échéances administratives (assurance, visite technique, vignette) | M1 |
| M4 | Entretien : plans au kilométrage ou à la date, historique | M1, M3 |
| M5 | Locataires et réservations (planning, chevauchements refusés) | M2, M3 |
| M6 | Départ et retour du véhicule, alertes de location (retard, usage hors location, sortie de zone) | M5 |
| M7 | Dépenses et rentabilité par véhicule | M4, M5 |
| M8 | Conducteurs (flottes d'entreprise) et affectations | M2 |
| M9 | Rapports et exports CSV | M5, M7 |
| M10 | Lien de partage temporaire de la position | M1 |
| M11 | Abonnements des clients (super-admin) | — |

Hors de ce plan mais déjà prévus dans `CLAUDE.md` : règles d'alertes (tranche 3 des alertes) et
notifications push (tranche 4) ; les alertes métier de ce plan passent par la même table `events`
et profiteront du push quand il existera.

## 3. Modèle de données

Esquisse Prisma, à ajuster à l'implémentation (types MySQL, index). Montants en
`Decimal @db.Decimal(12, 2)` (renvoyés en chaîne par l'API). Dates sans heure en `@db.Date`,
interprétées dans le fuseau du client.

### M1 — Socle

```prisma
// Ajouts à Tenant
model Tenant {
  // …
  currency       Currency @default(MAD)                              // décidé : MAD, EUR ou USD, au choix par client
  timezone       String  @default("Africa/Casablanca") @db.VarChar(64)
  rentalsEnabled Boolean @default(false) // module location (M5, M6)
  driversEnabled Boolean @default(false) // module conducteurs (M8)
}

// Ajouts à Vehicle (tous facultatifs)
model Vehicle {
  // …
  brand      String?   @db.VarChar(64)
  model      String?   @db.VarChar(64)
  year       Int?
  vin        String?   @db.VarChar(32)
  fuelType   FuelType?
  color      String?   @db.VarChar(32)
  notes      String?   @db.Text
}

enum FuelType { GASOLINE DIESEL HYBRID ELECTRIC LPG OTHER }

enum Currency { MAD EUR USD }

// Relevés du compteur kilométrique. Le compteur estimé d'un véhicule = dernier relevé
// + distance GPS parcourue depuis (somme des trajets plausibles, calcul existant de lib/traccar.ts).
// On ne s'appuie PAS sur totalDistance de Traccar seul : il est faussé par les sauts au point 0,0.
model OdometerReading {
  id         String         @id @default(cuid())
  tenantId   String
  vehicleId  String
  readAt     DateTime
  km         Int
  source     OdometerSource
  rentalId   String?        // relevé de départ ou de retour (M6)
  createdBy  String?        // utilisateur, vide si automatique
  createdAt  DateTime       @default(now())
  @@index([vehicleId, readAt])
  @@map("odometer_readings")
}

enum OdometerSource { MANUAL RENTAL_OUT RENTAL_IN MAINTENANCE }

// Événements : la table existante accueille aussi les alertes produites par l'API.
model Event {
  // …
  traccarEventId Int?    @unique          // devient facultatif (MySQL accepte plusieurs NULL)
  source         EventSource @default(TRACCAR)
  dedupKey       String? @unique @db.VarChar(191) // ex. "doc:<id>:J-30" : une alerte interne n'est créée qu'une fois
  rentalId       String?
  message        String? @db.VarChar(255)  // détail lisible (échéance, réservation…)
}

enum EventSource { TRACCAR APP }
```

Passer `traccarEventId` en facultatif ne transforme aucune donnée existante : migration acceptable
sans accord, mais à signaler dans le bilan.

Nouveaux types d'événement internes (à ajouter à `EVENT_TYPES` et `ALERT_TYPES`,
`src/lib/events.ts`) : `DOCUMENT_EXPIRING`, `DOCUMENT_EXPIRED`, `MAINTENANCE_DUE`,
`MAINTENANCE_OVERDUE`, `RENTAL_OVERDUE`, `RENTAL_UNAUTHORIZED_USE`, `RENTAL_ZONE_EXIT`.

**Tâche planifiée** : boucle dans le processus de l'API (`src/jobs/scheduler.ts`, toutes les
5 minutes, plus une passe quotidienne à 07:00 dans le fuseau de chaque client). Chaque passe est
idempotente grâce à `dedupKey`. Une seule instance de l'API aujourd'hui ; si elle est répliquée un
jour, ajouter un verrou en base (`GET_LOCK` de MySQL). Désactivée quand `NODE_ENV=test`, appelée
directement par les tests.

### M2 — Comptes multiples

```prisma
enum Role {
  SUPER_ADMIN
  TENANT_ADMIN
  AGENT   // nouveau : réservations, départs et retours, dépenses ; ni comptes, ni branding, ni coupure moteur
  VIEWER
}

// Ajout à User
model User {
  // …
  disabledAt DateTime? // compte désactivé par l'admin du client : sessions fermées, connexion refusée
}
```

Ajouter une valeur à l'enum est additif. Revoir tous les `requireRole(...)` et les tests de rôle
dans l'app (14 usages côté API, environ 150 mentions côté app) : par défaut, `AGENT` n'a pas plus de
droits que `VIEWER` sauf là où ce plan le dit.

### M3 — Indisponibilités et échéances

```prisma
model VehicleUnavailability {
  id         String   @id @default(cuid())
  tenantId   String
  vehicleId  String
  startAt    DateTime
  endAt      DateTime?            // vide = jusqu'à nouvel ordre
  reason     UnavailabilityReason
  notes      String?  @db.VarChar(500)
  maintenanceRecordId String?     // si liée à un entretien (M4)
  createdBy  String
  createdAt  DateTime @default(now())
  @@index([vehicleId, startAt])
  @@map("vehicle_unavailabilities")
}

enum UnavailabilityReason { MAINTENANCE REPAIR ACCIDENT OTHER }

model VehicleDeadline {
  id             String       @id @default(cuid())
  tenantId       String
  vehicleId      String
  type           DeadlineType
  label          String?      @db.VarChar(100) // obligatoire si type = OTHER
  expiresOn      DateTime     @db.Date
  reference      String?      @db.VarChar(100) // n° de police, de PV…
  warnDaysBefore Int          @default(30)
  notes          String?      @db.VarChar(500)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  @@index([tenantId, expiresOn])
  @@map("vehicle_deadlines")
}

enum DeadlineType { INSURANCE TECHNICAL_INSPECTION ROAD_TAX REGISTRATION OTHER }
```

Renouveler une échéance = modifier `expiresOn` (les alertes repartent car `dedupKey` contient la
date). Pas de pièce jointe dans un premier temps (à confirmer).

### M4 — Entretien

```prisma
model MaintenancePlan {
  id            String   @id @default(cuid())
  tenantId      String
  vehicleId     String
  type          MaintenanceType
  label         String?  @db.VarChar(100)
  intervalKm    Int?     // au moins un des deux intervalles
  intervalDays  Int?
  lastDoneAt    DateTime? @db.Date
  lastDoneKm    Int?
  warnBeforeKm  Int      @default(1000)
  warnBeforeDays Int     @default(15)
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([vehicleId])
  @@map("maintenance_plans")
}

enum MaintenanceType { OIL_CHANGE TIRES BRAKES TIMING_BELT SERVICE BATTERY AIR_CONDITIONING OTHER }

model MaintenanceRecord {
  id         String   @id @default(cuid())
  tenantId   String
  vehicleId  String
  planId     String?  // met à jour lastDoneAt / lastDoneKm du plan
  type       MaintenanceType
  label      String?  @db.VarChar(100)
  doneOn     DateTime @db.Date
  km         Int?
  garage     String?  @db.VarChar(191)
  notes      String?  @db.Text
  createdBy  String
  createdAt  DateTime @default(now())
  @@index([vehicleId, doneOn])
  @@map("maintenance_records")
}
```

Le coût d'un entretien est une dépense (M7) liée par `expenses.maintenanceRecordId` ; avant M7,
pas de coût. Prochaine échéance = `lastDoneKm + intervalKm` et/ou `lastDoneAt + intervalDays`, la
plus proche des deux ; comparée au compteur estimé (M1).

### M5 et M6 — Locataires et réservations

```prisma
model Customer {
  id            String   @id @default(cuid())
  tenantId      String
  kind          CustomerKind @default(PERSON)
  name          String   @db.VarChar(191)  // nom complet ou raison sociale
  phone         String?  @db.VarChar(32)
  email         String?  @db.VarChar(191)
  address       String?  @db.VarChar(500)
  birthDate     DateTime? @db.Date
  // Données sensibles, chiffrées par l'API (voir « Protection des données des locataires ») :
  idDocumentType   IdDocumentType?
  idDocumentEnc    String? @db.VarChar(255) // n° de CIN ou de passeport, chiffré
  idDocumentLast4  String? @db.VarChar(4)   // 4 derniers caractères, pour l'affichage masqué
  idDocumentHash   String? @db.Char(64)     // HMAC du n° normalisé : recherche exacte et doublons
  licenseNumberEnc String? @db.VarChar(255) // n° de permis, chiffré
  licenseLast4     String? @db.VarChar(4)
  licenseExpiresOn DateTime? @db.Date
  anonymizedAt  DateTime? // données personnelles effacées (droit à l'effacement, durée de conservation)
  notes         String?  @db.Text
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([tenantId, name])
  @@index([tenantId, idDocumentHash])
  @@map("customers")
}

enum CustomerKind { PERSON COMPANY }

enum IdDocumentType { NATIONAL_ID PASSPORT RESIDENCE_PERMIT OTHER }

model Rental {
  id             String       @id @default(cuid())
  tenantId       String
  vehicleId      String
  customerId     String
  driverName     String?      @db.VarChar(191) // si le conducteur n'est pas le client
  status         RentalStatus @default(RESERVED)
  startAt        DateTime     // prévu
  endAt          DateTime     // prévu
  pickedUpAt     DateTime?    // départ réel (M6)
  returnedAt     DateTime?    // retour réel (M6)
  odometerOutKm  Int?
  odometerInKm   Int?
  fuelOut        Int?         // niveau en huitièmes (0 à 8)
  fuelIn         Int?
  gpsDistanceKm  Float?       // distance GPS entre départ et retour, calculée au retour
  price          Decimal?     @db.Decimal(12, 2) // saisi, pas de grille tarifaire (à confirmer)
  deposit        Decimal?     @db.Decimal(12, 2)
  allowedZoneId  String?      // zone que le véhicule ne doit pas quitter (M6)
  notes          String?      @db.Text
  createdBy      String
  cancelledAt    DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  @@index([tenantId, startAt])
  @@index([vehicleId, startAt])
  @@map("rentals")
}

enum RentalStatus { RESERVED ONGOING COMPLETED CANCELLED }
```

Règles :
- **Chevauchement refusé** (409 `RENTAL_OVERLAP` ou `VEHICLE_UNAVAILABLE`) avec toute réservation
  `RESERVED`/`ONGOING` et toute indisponibilité du véhicule. MySQL n'a pas de contrainte
  d'exclusion : vérifier dans une transaction qui verrouille la ligne du véhicule
  (`SELECT … FOR UPDATE` via `$queryRaw`), test de deux créations simultanées obligatoire.
- Transitions : `RESERVED → ONGOING` (départ : compteur et carburant), `ONGOING → COMPLETED`
  (retour : compteur, carburant, calcul de `gpsDistanceKm`), `RESERVED → CANCELLED`. Pas de retour
  en arrière, sauf correction des relevés par `TENANT_ADMIN`.
- Départ et retour créent un `OdometerReading` (`RENTAL_OUT`, `RENTAL_IN`).
- Alertes (tâche planifiée) : `RENTAL_OVERDUE` (`endAt` dépassé, pas de retour) ;
  `RENTAL_UNAUTHORIZED_USE` (contact mis ou véhicule qui roule sans location `ONGOING`, seulement
  pour un client avec `rentalsEnabled` et hors indisponibilité) ; `RENTAL_ZONE_EXIT` (sortie de
  `allowedZoneId` pendant la location, à partir des événements `ZONE_EXIT` de Traccar : la zone doit
  surveiller le véhicule, la création de la location l'y ajoute au besoin, en respectant la limite
  de 5 zones par véhicule).
- **Photos d'état des lieux et contrat PDF : dans cette version** (décidé), voir ci-dessous.
- **Aucune coupure moteur automatique** liée à une location : hors périmètre (risque juridique et de
  sécurité). La fiche de location peut seulement mener à la fiche véhicule, où la coupure existe.
- Prix **saisi à la main** par location (décidé) : pas de grille tarifaire. Paiement en ligne hors
  périmètre.

#### Protection des données des locataires (décidé : données enregistrées, mais sécurisées)

- **Chiffrement applicatif** des n° de pièce d'identité et de permis : AES-256-GCM (`node:crypto`),
  IV aléatoire par valeur, format `v1:<iv>:<tag>:<texte chiffré>` en base64 (`src/lib/crypto.ts`).
  Clé `DATA_ENCRYPTION_KEY` (32 octets en base64) dans le `.env` de l'API, **jamais en base ni dans le
  dépôt** : une fuite de la base ou d'une sauvegarde seule ne révèle rien. Préfixe de version pour
  permettre une rotation de clé plus tard.
- **Recherche sans déchiffrer** : HMAC-SHA-256 du numéro normalisé (majuscules, sans espaces ni
  tirets) avec une seconde clé `DATA_HASH_KEY`, pour retrouver un client par son n° et signaler un
  doublon.
- **Affichage masqué par défaut** (`••••1234`) dans toutes les listes et réponses. Le numéro complet
  n'est renvoyé que par `GET /customers/:id/identity` (A, G), en `Cache-Control: no-store`, et chaque
  consultation est journalisée dans `audit_log` (`customer.identity.view`). `VIEWER` et super-admin
  hors « Se connecter en tant que » ne le voient jamais.
- **Jamais dans les logs** ni dans `audit_log.details`, ni dans les exports CSV (M9 : colonnes
  masquées), ni dans les messages d'erreur. Test qui vérifie l'absence du numéro en clair dans la
  base et dans les logs capturés.
- Limite de débit sur les routes de clients (lecture de masse = signal d'extraction).
- **Anonymisation** : `POST /customers/:id/anonymize` (A) efface nom, coordonnées et numéros
  (refusée si une location est en cours) ; les locations restent, avec « Client anonymisé ». Purge
  automatique des clients sans location depuis plus de N ans (durée à faire valider par un juriste ;
  désactivée tant qu'elle n'est pas fixée).
- **Prérequis de déploiement** : l'utilisateur ajoute `DATA_ENCRYPTION_KEY` et `DATA_HASH_KEY` au
  `.env` du VPS (le compte `deploy` n'y a pas accès) ; leur donner la commande de génération
  (`openssl rand -base64 32`). L'API **refuse de démarrer** si le module location est activé pour un
  client et qu'une clé manque. **Perdre la clé = perdre les numéros** : l'utilisateur doit la
  sauvegarder hors du VPS.

#### M6 — Photos d'état des lieux et contrat PDF (décidé : maintenant)

```prisma
model RentalPhoto {
  id          String   @id @default(cuid())
  tenantId    String
  rentalId    String
  phase       RentalPhase   // départ ou retour
  fileName    String   @db.VarChar(64) // nom aléatoire sur le disque, jamais fourni par le client
  mimeType    String   @db.VarChar(32)
  sizeBytes   Int
  caption     String?  @db.VarChar(191) // « rayure porte avant gauche »…
  createdBy   String
  createdAt   DateTime @default(now())
  @@index([rentalId])
  @@map("rental_photos")
}

enum RentalPhase { PICKUP RETURN }

model RentalContract {
  id         String   @id @default(cuid())
  tenantId   String
  rentalId   String   @unique
  fileName   String   @db.VarChar(64)
  sha256     String   @db.Char(64) // empreinte du PDF figé au départ
  createdBy  String
  createdAt  DateTime @default(now())
  @@map("rental_contracts")
}
```

- **Photos** : JPEG, PNG ou WebP (type vérifié sur les octets, comme les logos), 8 Mo au plus,
  30 par phase. Redimensionnées et **débarrassées des métadonnées EXIF** (position GPS du téléphone)
  côté serveur avant stockage (`sharp` : vérifier la version et son installation sous Node 24 /
  `allowScripts`). Stockées sur un **volume Docker privé** (`rental-files`, dossier
  `RENTAL_FILES_DIR`), **jamais servies par une route publique** : `GET /rentals/:id/photos/:photoId`
  exige une session du client propriétaire (404 sinon), `Cache-Control: private, no-store`.
  Suppression d'une photo seulement par A, journalisée.
- **Capture** : sur mobile, `expo-image-picker` (appareil photo ou galerie ; vérifier la version
  compatible SDK 58 avec `npx expo install`) ; sur le web, champ fichier avec `capture`. Envoi un
  par un avec reprise en cas d'échec réseau (parking, sous-sol).
- **Contrat PDF** : généré par l'API au **départ** (`POST /rentals/:id/pickup`), puis figé : fichier
  stocké avec son empreinte SHA-256, jamais régénéré (un contrat signé ne doit pas changer). Contenu :
  branding du client (logo, nom, adresse, téléphone), locataire (**n° de pièce d'identité complet**,
  décidé le 2026-11-21 ; le PDF est donc une donnée sensible : stockage privé, jamais public), véhicule (marque,
  modèle, plaque), dates prévues, compteur et carburant au départ, prix, caution, devise, conditions
  générales du client (nouveau champ `tenants.rentalTerms`, texte saisi par l'admin), zones de
  signature. Bibliothèque : `pdfkit` ou `pdf-lib`, à choisir après vérification des versions.
  Police embarquée gérant le français. **Contrat en français uniquement** (décidé le 2026-11-21).
- **Signature** : signature sur papier du contrat imprimé dans cette version ; signature dessinée à
  l'écran plus tard (à confirmer).
- **Retour** : `GET /rentals/:id/return-report.pdf` généré à la demande (compteur, carburant,
  distance GPS, photos de retour en miniature).
- **Sauvegardes** : le volume `rental-files` doit être sauvegardé avec la base (le volume `logos`
  aussi) : prévoir la commande et la documenter dans `CLAUDE.md` à cette tranche.

### M7 — Dépenses

```prisma
model Expense {
  id                  String   @id @default(cuid())
  tenantId            String
  vehicleId           String
  spentOn             DateTime @db.Date
  category            ExpenseCategory
  amount              Decimal  @db.Decimal(12, 2)
  liters              Float?   // carburant
  km                  Int?     // compteur au moment de la dépense
  maintenanceRecordId String?
  notes               String?  @db.VarChar(500)
  createdBy           String
  createdAt           DateTime @default(now())
  @@index([vehicleId, spentOn])
  @@index([tenantId, spentOn])
  @@map("expenses")
}

enum ExpenseCategory { FUEL MAINTENANCE REPAIR INSURANCE TAX TOLL FINE PARKING CLEANING OTHER }
```

Rentabilité par véhicule et par période : recettes (`rentals.price` des locations `COMPLETED`
terminées dans la période) − dépenses ; coût au kilomètre ; consommation si des pleins sont saisis.
Devise unique : celle du client.

### M8 — Conducteurs (flottes d'entreprise)

```prisma
model Driver {
  id            String   @id @default(cuid())
  tenantId      String
  name          String   @db.VarChar(191)
  phone         String?  @db.VarChar(32)
  licenseNumber String?  @db.VarChar(64)
  licenseExpiresOn DateTime? @db.Date // alerte d'expiration comme les échéances
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@map("drivers")
}

model DriverAssignment {
  id        String    @id @default(cuid())
  tenantId  String
  driverId  String
  vehicleId String
  startAt   DateTime
  endAt     DateTime? // vide = en cours ; une seule affectation ouverte par véhicule
  @@index([vehicleId, startAt])
  @@map("driver_assignments")
}
```

Les trajets, excès de vitesse et alertes d'une période sont attribués au conducteur affecté à ce
moment. Identification par badge (iButton) hors périmètre : dépend du traceur.

### M10 — Lien de partage

```prisma
model ShareLink {
  id        String    @id @default(cuid())
  tenantId  String
  vehicleId String
  tokenHash String    @unique @db.Char(64) // SHA-256 du jeton ; le jeton n'est montré qu'une fois
  expiresAt DateTime  // 1 h à 7 jours
  revokedAt DateTime?
  createdBy String
  createdAt DateTime  @default(now())
  @@map("share_links")
}
```

Route publique `GET /api/public/share/:token` : nom du véhicule, dernière position, heure, rien
d'autre (ni plaque, ni historique, ni client) ; limite de débit ; 404 générique si expiré ou
révoqué. Page web `/share/[token]` sans connexion.

### M11 — Abonnements

```prisma
// Ajouts à Tenant
model Tenant {
  // …
  plan          String?   @db.VarChar(32)
  vehicleQuota  Int?      // nombre de traceurs prévus au contrat
  paidUntil     DateTime? @db.Date
  billingNotes  String?   @db.Text
}
```

Super-admin seulement : liste des clients à échéance dépassée, quota de véhicules affiché à
l'affectation d'un traceur. **Pas de suspension automatique** (à confirmer) : le super-admin
suspend à la main avec le statut existant. Pas de paiement en ligne.

## 4. API par tranche

Préfixe `/api`. Rôles : A = `TENANT_ADMIN`, G = `AGENT`, V = `VIEWER`, S = `SUPER_ADMIN`
(lecture de tous les clients comme aujourd'hui, et « Se connecter en tant que » pour écrire).

- **M1** : `PUT /vehicles/:id` (A : marque, modèle, année, VIN, carburant, couleur, notes, plaque,
  nom) ; `GET /vehicles/:id/odometer` (tous : compteur estimé, relevés) ;
  `POST /vehicles/:id/odometer` (A, G : relevé manuel). `GET /me` renvoie les modules activés, la
  devise et le fuseau. Back-office : activer les modules, devise et fuseau
  (`PUT /admin/tenants/:id`).
- **M2** : `GET/POST /tenant/users`, `PUT /tenant/users/:id` (rôle, nom), `POST
  /tenant/users/:id/reset-password`, `POST /tenant/users/:id/disable|enable` (A). Mot de passe
  provisoire et `mustChangePassword` comme dans le back-office. 20 comptes par client au plus. Un
  admin ne peut ni se désactiver ni retirer son propre rôle ; il reste toujours au moins un
  `TENANT_ADMIN` actif.
- **M3** : `GET/POST /vehicles/:id/unavailabilities`, `PUT/DELETE /unavailabilities/:id` (A, G) ;
  `GET /deadlines?dueWithinDays` (tous), `GET/POST /vehicles/:id/deadlines`,
  `PUT/DELETE /deadlines/:id` (A).
- **M4** : `GET/POST /vehicles/:id/maintenance-plans`, `PUT/DELETE /maintenance-plans/:id` (A) ;
  `GET/POST /vehicles/:id/maintenance-records` (A, G) ; `GET /maintenance/due` (tous : échéances à
  venir de toute la flotte).
- **M5** : `GET/POST /customers?q`, `GET/PUT /customers/:id` (A, G ; numéros masqués),
  `GET /customers/:id/identity` (A, G, journalisé), `POST /customers/:id/anonymize` (A) ; `GET /rentals?from&to&vehicleId&status` (tous), `POST /rentals`,
  `GET/PUT /rentals/:id`, `POST /rentals/:id/cancel` (A, G) ; `GET /vehicles/availability?from&to`
  (véhicules libres sur une période). Toutes ces routes → 404 si `rentalsEnabled` est faux.
- **M6** : `POST /rentals/:id/pickup`, `POST /rentals/:id/return` (A, G) ;
  `GET/POST /rentals/:id/photos`, `GET /rentals/:id/photos/:photoId`, `DELETE` (A) ;
  `GET /rentals/:id/contract.pdf`, `GET /rentals/:id/return-report.pdf` (A, G, V).
- **M7** : `GET/POST /expenses`, `PUT/DELETE /expenses/:id` (A, G pour créer ; A pour supprimer) ;
  `GET /reports/profitability?from&to` (A, V).
- **M8** : `GET/POST /drivers`, `PUT /drivers/:id`, `POST /vehicles/:id/driver` (affecter ou
  libérer) (A). 404 si `driversEnabled` est faux.
- **M9** : `GET /exports/{trips|rentals|expenses|maintenance}.csv?from&to&vehicleId` (A, V ; 31 jours
  au plus pour les trajets, 1 an pour le reste). CSV en UTF-8 avec BOM et séparateur `;` (ouverture
  directe dans Excel en français). PDF et envoi par e-mail plus tard (pas de service d'e-mail).
- **M10** : `POST /vehicles/:id/share-links` (A, G), `GET /vehicles/:id/share-links`,
  `DELETE /share-links/:id` ; `GET /public/share/:token`.
- **M11** : champs ajoutés à `GET/PUT /admin/tenants/:id`, `GET /admin/billing` (S).

## 5. Écrans de l'app

- **Fiche véhicule** (`/vehicles/[id]`) : nouveaux blocs « Informations », « Compteur »,
  « Échéances », « Entretien », « Dépenses », « Locations » (si module), « Conducteur » (si module),
  chacun avec un lien vers la liste complète.
- **Onglet « Locations »** (si `rentalsEnabled`) : planning par véhicule sur 2 semaines (lignes =
  véhicules, barres = locations et indisponibilités), liste du jour (départs, retours, retards),
  création en choisissant période puis véhicule libre puis client ; fiche de location avec boutons
  « Départ » et « Retour ».
- **Écran « Flotte »** ou section du tableau de bord : échéances et entretiens à venir, véhicules
  indisponibles.
- **Profil → « Utilisateurs »** (A) : comptes du client.
- **Alertes** : nouveaux types avec libellé et icône.
- **Back-office** : modules, devise, fuseau, abonnement.
- Sur mobile, le planning devient une liste par jour (pas de grille large sous 900 px).

## 6. Décisions de l'utilisateur (2026-11-21)

1. **Devise** : au choix par client parmi **MAD, EUR et USD** (l'utilisateur a écrit « MAR » : code
   ISO du dirham = MAD). MAD par défaut. Une seule devise par client, pas de conversion.
2. **Données du locataire** : n° de pièce d'identité et de permis **enregistrés, mais sécurisés**
   contre une fuite (chiffrement, masquage, journal des consultations, anonymisation : voir M5).
3. **Prix** : saisi à la main par location.
4. **Photos d'état des lieux et contrat PDF** : **dans cette version** (M6).
5. **Suspension automatique après impayé** : plus tard ; suspension à la main en attendant (M11).

6. **Contrat PDF** (2026-11-21) : numéro de pièce d'identité **complet** sur le contrat ; contrat
   **en français uniquement**.
7. **Ordre** (recommandation du 2026-11-21) : tranche 3 de la refonte (fiche véhicule), M3, puis M5
   et M6 (location) avant M4 (entretien), M5 ne dépendant que de M2 et M3.

Restent « à confirmer » au fil des tranches : pièces jointes des échéances (M3), signature dessinée
à l'écran (M6).

## 7. Suivi

Mettre à jour la section « Étape en cours » de `CLAUDE.md` à chaque tranche (écrite, testée,
déployée, commit) et cocher ici :

- [x] M1 Socle (déployé le 2026-11-21)
- [x] M2 Comptes multiples (déployé le 2026-11-21)
- [x] M3 Indisponibilités et échéances (déployé le 2026-11-22)
- [x] M4 Entretien (déployé le 2026-11-22)
- [x] M5 Locataires et réservations (déployé le 2026-11-22)
- [x] M6 Départ, retour et alertes de location (déployé le 2026-11-22)
- [x] M7 Dépenses et rentabilité (déployé le 2026-11-22)
- [x] M8 Conducteurs (déployé le 2026-11-22)
- [x] M9 Exports CSV (déployé le 2026-11-22)
- [x] M10 Lien de partage (déployé le 2026-11-22)
- [ ] M11 Abonnements
