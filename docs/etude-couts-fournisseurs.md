# Étude — coûts des fournisseurs (cartes, géocodage, e-mails, SMS, WhatsApp)

Rédigée le 2026-11-21 à la demande de l'utilisateur. Tarifs relevés le même jour sur les pages de
prix officielles (sources en fin de document), **hors TVA**. Les prix changent souvent : revérifier
avant de souscrire. Change utilisé : 1 € = 1,0968 $ (Banque de France, 18/11/2026), soit 1 $ ≈ 0,912 €.

## Pourquoi

Avant d'ouvrir le service à de nombreux clients, il faut remplacer :
- les **tuiles OpenStreetMap publiques** de la carte web (interdites en usage commercial intensif) ;
- **Nominatim public** pour les adresses (1 requête par seconde, pas d'usage commercial intensif).

Et, si on veut des alertes hors de l'application et des e-mails (mots de passe, rapports), il faut
un service d'envoi d'e-mails et un canal SMS ou WhatsApp.

## Hypothèses de volume

| | Départ | Cible |
|---|---|---|
| Clients / utilisateurs / véhicules | 10 / 30 / 150 | 150 / 450 / 2 000 |
| Tuiles de la carte web (15 000 par utilisateur et par mois) | 450 000 | 6,75 M |
| Adresses (géocodage inverse, après cache) | 10 000 | 100 000 |
| E-mails | 1 000 | 20 000 |
| SMS ou WhatsApp (80 % Maroc, 20 % France) | 300 | 5 000 |

**Cartes mobiles gratuites** : l'app mobile utilise Apple Maps (iOS) et le Maps SDK de Google
(Android), gratuit et illimité aujourd'hui. Les tuiles payantes ne concernent que **l'app web**. Si
l'usage est surtout mobile, le coût réel des tuiles sera plus bas que ci-dessous.

## Résumé

| Poste | Recommandation | Départ | Cible |
|---|---|---|---|
| Tuiles + adresses | **Stadia Maps Standard** (un seul abonnement pour les deux) | 73 € | ~96 € |
| E-mails | **Scaleway TEM** (France) | 0,18 € | 4,93 € |
| Alertes par WhatsApp | **Twilio** | 8 € | 134 € |
| *ou* alertes par SMS | **Infobip** | 45 € | 753 € |
| **Total avec WhatsApp** | | **≈ 81 €/mois** | **≈ 235 €/mois** |
| **Total avec SMS** | | **≈ 118 €/mois** | **≈ 854 €/mois** |

**Le choix du canal d'alerte pèse plus que tout le reste réuni** : WhatsApp coûte environ six fois
moins cher que le SMS vers le Maroc, et y est très utilisé. Conseil : WhatsApp en canal principal,
SMS en secours, notifications push de l'app (gratuites) pour tout le reste.

## 1. Tuiles de la carte web

| Fournisseur | Offre | Départ | Cible | Points d'attention |
|---|---|---|---|---|
| **Stadia Maps** | Starter 20 $ (1 M crédits) / Standard 80 $ (7,5 M) | 18 € | 73 € | 1 tuile = 1 crédit. Offre gratuite non commerciale. |
| MapTiler | Flex 30 $ | 27 € | 882 € (raster) / ~124 € (vectoriel) | Tuile raster 512 px = 4 requêtes. Cache côté serveur interdit. Offre gratuite non commerciale. |
| Mapbox Raster Tiles | Paiement à l'usage | 0 € (750 000 gratuites) | ~1 026 € | Paliers de 0,25 $ à 0,15 $ les 1 000 tuiles. |
| Thunderforest | Solo 115 € / Small Business 235 € | 115 € | 235 € | Usage commercial non précisé. |
| Geoapify | 10 à 59 $ / 100 à 299 $ | 54 € | 273 € | Quota quotidien (attention aux pics). Inclut le géocodage. |
| Google Map Tiles 2D | Essentials | 192 € | ~2 818 € | Le plus cher. |
| Protomaps auto-hébergé | Fichier PMTiles servi par notre Nginx | ~0 € | ~0 € | Tuiles **vectorielles** : changer la carte web pour MapLibre GL (ou protomaps-leaflet). Mises à jour des données à notre charge. Attribution OSM. |

Recommandation : **Stadia Maps**. Piste d'économie à terme : passer la carte web en vectoriel et
auto-héberger un extrait Maroc + France avec Protomaps (coût quasi nul, un peu de travail).

## 2. Adresses (géocodage inverse)

Contrainte : le fournisseur doit **autoriser le stockage** des adresses, car l'API les garde en cache.

| Fournisseur | Offre | Départ | Cible | Stockage |
|---|---|---|---|---|
| **Stadia** | Inclus dans Standard (1 adresse = 20 crédits) | inclus | inclus | Permanent en Standard et au-dessus, tant que l'abonnement est actif. |
| **OpenCage** | X-Small 45 € (10 000 par jour) | 45 € | 45 € | Permanent, même après résiliation. Société allemande. La clause la plus claire. |
| LocationIQ | Developer 100 $ | 91 € | 91 € | Permanent sur les offres payantes. |
| Mapbox Permanent | 5 $ les 1 000 | 46 € | 456 € | La version « temporary » interdit tout cache. |
| Google Geocoding | 10 000 gratuites puis 5 $ les 1 000 | 0 € | 410 € | **Éliminé** : adresses non stockables (seul l'identifiant de lieu peut l'être). |
| MapTiler | Inclus dans Flex | — | — | Conditions ambiguës sur le stockage permanent. |
| Nominatim auto-hébergé | Sur un VPS | ~0 à 6 € | ~0 à 6 € | Maroc seul : petit serveur (estimation 4 à 8 Go de RAM, à mesurer). Europe + Maroc : ≥ 64 Go de RAM. |

Tous s'appuient sur OpenStreetMap au Maroc : la qualité des adresses y reste celle d'aujourd'hui.
Recommandation : **Stadia** (déjà payé avec les tuiles) ; **OpenCage** si on veut un fournisseur
d'adresses indépendant.

## 3. E-mails transactionnels

| Fournisseur | Départ | Cible | Points d'attention |
|---|---|---|---|
| **Scaleway TEM** | 0,18 € | 4,93 € | 300 gratuits puis 0,25 € les 1 000. France (UE). |
| Amazon SES | 0,09 € | 1,82 € | 0,10 $ les 1 000. Région Paris disponible. |
| Brevo | 0 € (300 par jour) | à partir de 9 $ | Volume du palier non vérifié. |
| Mailjet | 0 € (6 000 par mois) | non vérifié | 15 000 e-mails pour 19 $ : insuffisant à la cible. |
| Resend | 0 € (100 par jour) | 18 € | Région UE non confirmée. |
| Postmark | 14 € | ~33 € | Hébergement non précisé. |

Recommandation : **Scaleway TEM** (moins de 5 € par mois même à la cible, hébergé en France).

## 4. SMS

| Fournisseur | Prix par SMS Maroc / France | Départ | Cible |
|---|---|---|---|
| **Infobip** | 0,170 € / 0,072 € | 45 € | 753 € |
| Twilio | 0,2244 $ / 0,0798 $ | 53 € | 891 € |
| Brevo, Octopush, Vonage | Maroc non vérifié (France ~0,045 €, sources non officielles) | — | — |
| Fournisseurs marocains | Aucun tarif public (sur devis) | — | — |

Expéditeur :
- **Maroc** : nom d'expéditeur **préenregistré obligatoire**, compter environ 3 semaines.
- **France** : nom libre, sans préenregistrement (pas de mots génériques comme « Info »).

## 5. WhatsApp (messages « utility »)

| Intermédiaire | Coût | Départ | Cible |
|---|---|---|---|
| **Twilio** | Meta 0,023 $ (Maroc) / 0,030 $ (France) + 0,005 $ par message | 8 € | 134 € |
| 360dialog | 49 € par numéro et par mois + tarifs Meta sans marge | ~56 € | ~160 € |

## Incertitudes et points à vérifier

1. **Tarif WhatsApp au Maroc** : Meta a sorti le Maroc du groupe « Reste de l'Afrique » le
   01/10/2026 et augmenté les prix ; la grille de Twilio est peut-être antérieure. Vérifier la grille
   Meta.
2. Depuis le 01/10/2026, les messages WhatsApp « utility » sont payants même pendant la fenêtre de
   service client.
3. Pages de prix de Scaleway et de Brevo illisibles lors de la recherche : chiffres Scaleway tirés de
   sa documentation (vérifier l'absence de frais fixes).
4. Lieu de traitement des données de Stadia (UE ou non) non vérifié ; usage commercial de
   Thunderforest non précisé ; stockage des adresses chez Geoapify non précisé.
5. Ressources de Nominatim pour le Maroc seul : estimations à mesurer par un import d'essai.
6. SMS vers le Maroc : demander un devis en volume à Infobip et Twilio, enregistrement de
   l'expéditeur inclus.

## Ce que cela implique dans le code (pour plus tard)

- Tuiles : l'URL est déjà paramétrable (`EXPO_PUBLIC_MAP_TILE_URL`) ; il suffit d'y mettre l'URL du
  fournisseur avec sa clé (clé restreinte au domaine `autolocalize.net`).
- Adresses : l'API passe aujourd'hui par Traccar (`/api/server/geocode`, qui appelle Nominatim) ;
  changer le géocodeur dans `traccar.xml` ou appeler directement le fournisseur depuis
  `apps/api/src/lib/addresses.ts`.
- E-mails, SMS, WhatsApp : rien n'existe encore ; ils viendraient avec la tranche « notifications »
  (push d'abord, puis ces canaux).

## Sources

- Stadia : https://stadiamaps.com/pricing/ — conditions : https://stadiamaps.com/terms-of-service/
- MapTiler : https://www.maptiler.com/cloud/pricing/ — conditions : https://www.maptiler.com/terms/cloud/
- Mapbox : https://www.mapbox.com/pricing — géocodage : https://docs.mapbox.com/api/search/geocoding/
- Thunderforest : https://www.thunderforest.com/pricing/
- Geoapify : https://www.geoapify.com/pricing/ et https://www.geoapify.com/pricing-details/
- Google : https://developers.google.com/maps/billing-and-pricing/pricing — règles du géocodage :
  https://developers.google.com/maps/documentation/geocoding/policies
- Protomaps : https://docs.protomaps.com/basemaps/downloads
- OpenCage : https://opencagedata.com/pricing
- LocationIQ : https://locationiq.com/pricing
- Nominatim : https://nominatim.org/release-docs/latest/admin/Installation/ — extraits :
  https://download.geofabrik.de/ — VPS : https://www.hetzner.com/cloud/
- Scaleway TEM : https://www.scaleway.com/en/docs/transactional-email/concepts/
- Amazon SES : https://aws.amazon.com/ses/pricing/
- Brevo : https://help.brevo.com/hc/en-us/articles/208589409
- Mailjet : https://www.mailjet.com/pricing/ — Resend : https://resend.com/pricing — Postmark :
  https://postmarkapp.com/pricing
- Infobip : https://www.infobip.com/sms/pricing
- Twilio SMS : https://www.twilio.com/en-us/sms/pricing/ma et https://www.twilio.com/en-us/sms/pricing/fr
  — règles d'expéditeur : https://www.twilio.com/en-us/guidelines/ma/sms et
  https://www.twilio.com/en-us/guidelines/fr/sms
- Twilio WhatsApp : https://www.twilio.com/en-us/whatsapp/pricing — 360dialog : https://360dialog.com/pricing
  (à confirmer) — Meta : https://developers.facebook.com/docs/whatsapp/pricing
- Change : https://www.banque-france.fr/fr/statistiques/taux-et-cours/taux-de-change-parites-quotidiennes-2026-11-18
