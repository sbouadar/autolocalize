-- M11 (plan des fonctions métier) : abonnement des clients, géré par le super-admin.
-- Uniquement des ajouts de colonnes facultatives.
-- AlterTable
ALTER TABLE `tenants` ADD COLUMN `plan` VARCHAR(32) NULL,
    ADD COLUMN `vehicleQuota` INTEGER NULL,
    ADD COLUMN `monthlyFee` DECIMAL(12, 2) NULL,
    ADD COLUMN `paidUntil` DATE NULL,
    ADD COLUMN `billingNotes` TEXT NULL;
