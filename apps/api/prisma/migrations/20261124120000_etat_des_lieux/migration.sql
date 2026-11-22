-- État des lieux de la location : impacts marqués sur le schéma du véhicule au départ et au retour.
-- Uniquement des ajouts de colonnes facultatives.
-- AlterTable
ALTER TABLE `rentals` ADD COLUMN `damagesIn` JSON NULL,
    ADD COLUMN `damagesOut` JSON NULL;
