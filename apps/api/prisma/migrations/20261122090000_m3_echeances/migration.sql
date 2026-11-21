-- M3 (plan des fonctions métier) : indisponibilités et échéances administratives des véhicules.
-- Uniquement des créations de tables.
-- CreateTable
CREATE TABLE `vehicle_unavailabilities` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NULL,
    `reason` ENUM('MAINTENANCE', 'REPAIR', 'ACCIDENT', 'OTHER') NOT NULL,
    `notes` VARCHAR(500) NULL,
    `maintenanceRecordId` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `vehicle_unavailabilities_vehicleId_startAt_idx`(`vehicleId`, `startAt`),
    INDEX `vehicle_unavailabilities_tenantId_startAt_idx`(`tenantId`, `startAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicle_deadlines` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `type` ENUM('INSURANCE', 'TECHNICAL_INSPECTION', 'ROAD_TAX', 'REGISTRATION', 'OTHER') NOT NULL,
    `label` VARCHAR(100) NULL,
    `expiresOn` DATE NOT NULL,
    `reference` VARCHAR(100) NULL,
    `warnDaysBefore` INTEGER NOT NULL DEFAULT 30,
    `notes` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `vehicle_deadlines_tenantId_expiresOn_idx`(`tenantId`, `expiresOn`),
    INDEX `vehicle_deadlines_vehicleId_idx`(`vehicleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `vehicle_unavailabilities` ADD CONSTRAINT `vehicle_unavailabilities_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle_unavailabilities` ADD CONSTRAINT `vehicle_unavailabilities_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle_deadlines` ADD CONSTRAINT `vehicle_deadlines_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle_deadlines` ADD CONSTRAINT `vehicle_deadlines_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

