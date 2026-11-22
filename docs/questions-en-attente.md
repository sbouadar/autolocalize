# Questions en attente pour l'utilisateur

Consigne du 2026-11-21 : l'utilisateur n'est pas disponible pour décider pendant les tranches en
cours. Chaque question est notée ici avec le choix fait par défaut ; **les poser dès le début de la
prochaine session**, puis vider ce fichier.

1. **Échéances (M3) : faut-il pouvoir joindre un document** (attestation d'assurance, procès-verbal
   de visite technique) à une échéance ? Choix par défaut : non, seulement la date, le type et une
   référence. Les ajouter demanderait un stockage de fichiers privé (prévu de toute façon en M6).
2. **Locataires (M5) : au bout de combien de temps sans location faut-il effacer automatiquement
   les données d'un locataire ?** Choix par défaut : aucune purge automatique (seulement
   l'anonymisation à la main), en attendant une durée validée par un juriste.
3. **Location (M5) : pour quels clients activer le module ?** Il est désactivé pour tous. Pour
   l'essayer : back-office → fiche du client → « Réglages métier » → module Location. Si les clés
   du `.env` sont mal formées, l'activation le dira (message sur les clés de chiffrement).
4. **Location (M6) : l'alerte « véhicule utilisé hors location » doit-elle rester active pour tous
   les loueurs ?** Elle se déclenche (une fois par véhicule et par jour) dès qu'un véhicule roule ou
   a le contact mis sans location en cours, donc aussi quand le loueur déplace lui-même une voiture
   (lavage, garage). Choix par défaut : active pour tout client dont le module location est activé ;
   une indisponibilité déclarée sur le véhicule la suspend.
5. **Contrat (M6) : signature dessinée à l'écran ?** Choix par défaut : contrat imprimé et signé sur
   papier (deux exemplaires), comme prévu au plan.
6. **Contrat et état de retour sur mobile** : ils s'ouvrent aujourd'hui depuis la version web
   seulement. À ajouter à l'app mobile avant la publication dans les stores ?
7. **Sauvegardes** : aucune sauvegarde automatique n'existe (base, logos, photos et contrats). Les
   mettre en place demande un accès root au VPS : voulez-vous que je prépare un script versionné dans
   `deploy/` à lancer par une tâche planifiée du serveur, et où envoyer les sauvegardes (autre
   serveur, stockage objet) ?
8. **Agences (lieux de prise en charge et de dépôt)** : la liste proposée à la réservation est celle
   de votre site web, la même pour tous les clients. Faut-il une liste propre à chaque client,
   modifiable dans son Profil ? Choix par défaut : liste commune, plus « Autre (saisie libre) ».
9. **Ancienne réservation reprise dans le système** : elle est créée « Réservée » ; le départ et le
   retour saisis ensuite prennent la date du jour de la saisie. Faut-il pouvoir saisir la date et
   l'heure réelles du départ et du retour (ou créer directement la location comme « Terminée ») ?
