-- AlterTable
ALTER TABLE `vehicles` ADD COLUMN `historyStartAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- Véhicules existants : l'historique visible commençait jusqu'ici à l'affectation (createdAt).
UPDATE `vehicles` SET `historyStartAt` = `createdAt`;
