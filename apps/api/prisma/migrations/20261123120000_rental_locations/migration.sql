-- Lieux de prise en charge et de dépôt d'une location (agence de la liste ou saisie libre).
-- Uniquement des ajouts de colonnes facultatives.
-- AlterTable
ALTER TABLE `rentals` ADD COLUMN `pickupLocation` VARCHAR(191) NULL,
    ADD COLUMN `returnLocation` VARCHAR(191) NULL;
