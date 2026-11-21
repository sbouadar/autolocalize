-- M1 (plan des fonctions métier) : devise, fuseau et modules par client, fiche du véhicule, relevés du
-- compteur kilométrique, événements produits par l'API. Uniquement des ajouts ; traccarEventId devient
-- facultatif (aucune donnée transformée).
-- AlterTable
ALTER TABLE `events` ADD COLUMN `dedupKey` VARCHAR(191) NULL,
    ADD COLUMN `message` VARCHAR(255) NULL,
    ADD COLUMN `rentalId` VARCHAR(191) NULL,
    ADD COLUMN `source` ENUM('TRACCAR', 'APP') NOT NULL DEFAULT 'TRACCAR',
    MODIFY `traccarEventId` INTEGER NULL;

-- AlterTable
ALTER TABLE `tenants` ADD COLUMN `currency` ENUM('MAD', 'EUR', 'USD') NOT NULL DEFAULT 'MAD',
    ADD COLUMN `driversEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `rentalsEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `timezone` VARCHAR(64) NOT NULL DEFAULT 'Africa/Casablanca';

-- AlterTable
ALTER TABLE `vehicles` ADD COLUMN `brand` VARCHAR(64) NULL,
    ADD COLUMN `color` VARCHAR(32) NULL,
    ADD COLUMN `fuelType` ENUM('GASOLINE', 'DIESEL', 'HYBRID', 'ELECTRIC', 'LPG', 'OTHER') NULL,
    ADD COLUMN `model` VARCHAR(64) NULL,
    ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `vin` VARCHAR(32) NULL,
    ADD COLUMN `year` INTEGER NULL;

-- CreateTable
CREATE TABLE `odometer_readings` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NOT NULL,
    `km` INTEGER NOT NULL,
    `source` ENUM('MANUAL', 'RENTAL_OUT', 'RENTAL_IN', 'MAINTENANCE') NOT NULL,
    `rentalId` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `odometer_readings_vehicleId_readAt_idx`(`vehicleId`, `readAt`),
    INDEX `odometer_readings_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `events_dedupKey_key` ON `events`(`dedupKey`);

-- AddForeignKey
ALTER TABLE `odometer_readings` ADD CONSTRAINT `odometer_readings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `odometer_readings` ADD CONSTRAINT `odometer_readings_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

