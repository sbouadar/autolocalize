-- Alertes, tranche 3 : règles d'alerte par client et types d'alerte masqués par utilisateur.
-- Une table créée et une colonne facultative ajoutée ; aucune donnée transformée.

-- AlterTable
ALTER TABLE `user` ADD COLUMN `mutedAlertTypes` JSON NULL;

-- CreateTable
CREATE TABLE `alert_rules` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `type` ENUM('AFTER_HOURS', 'OFFLINE_DURATION', 'ZONE_DWELL') NOT NULL,
    `name` VARCHAR(100) NULL,
    `vehicleId` VARCHAR(191) NULL,
    `zoneId` VARCHAR(191) NULL,
    `startMinute` INTEGER NULL,
    `endMinute` INTEGER NULL,
    `days` VARCHAR(13) NULL,
    `thresholdMinutes` INTEGER NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `alert_rules_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `alert_rules` ADD CONSTRAINT `alert_rules_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alert_rules` ADD CONSTRAINT `alert_rules_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alert_rules` ADD CONSTRAINT `alert_rules_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `zones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

