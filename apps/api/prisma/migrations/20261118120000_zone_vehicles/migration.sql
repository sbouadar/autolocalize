-- AlterTable : couleur d'affichage de la zone.
ALTER TABLE `zones` ADD COLUMN `color` VARCHAR(7) NOT NULL DEFAULT '#2563EB';

-- CreateTable : véhicules surveillés par une zone (alerte à l'entrée et à la sortie).
CREATE TABLE `zone_vehicles` (
    `zoneId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `zone_vehicles_vehicleId_idx`(`vehicleId`),
    PRIMARY KEY (`zoneId`, `vehicleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `zone_vehicles` ADD CONSTRAINT `zone_vehicles_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `zones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `zone_vehicles` ADD CONSTRAINT `zone_vehicles_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
