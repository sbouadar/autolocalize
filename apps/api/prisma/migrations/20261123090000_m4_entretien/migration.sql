-- M4 (plan des fonctions métier) : plans d'entretien et entretiens réalisés.
-- Uniquement des créations de tables.
-- CreateTable
CREATE TABLE `maintenance_plans` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `type` ENUM('OIL_CHANGE', 'TIRES', 'BRAKES', 'TIMING_BELT', 'SERVICE', 'BATTERY', 'AIR_CONDITIONING', 'OTHER') NOT NULL,
    `label` VARCHAR(100) NULL,
    `intervalKm` INTEGER NULL,
    `intervalDays` INTEGER NULL,
    `lastDoneAt` DATE NULL,
    `lastDoneKm` INTEGER NULL,
    `warnBeforeKm` INTEGER NOT NULL DEFAULT 1000,
    `warnBeforeDays` INTEGER NOT NULL DEFAULT 15,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `maintenance_plans_vehicleId_idx`(`vehicleId`),
    INDEX `maintenance_plans_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `maintenance_records` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NULL,
    `type` ENUM('OIL_CHANGE', 'TIRES', 'BRAKES', 'TIMING_BELT', 'SERVICE', 'BATTERY', 'AIR_CONDITIONING', 'OTHER') NOT NULL,
    `label` VARCHAR(100) NULL,
    `doneOn` DATE NOT NULL,
    `km` INTEGER NULL,
    `garage` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `maintenance_records_vehicleId_doneOn_idx`(`vehicleId`, `doneOn`),
    INDEX `maintenance_records_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `maintenance_plans` ADD CONSTRAINT `maintenance_plans_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenance_plans` ADD CONSTRAINT `maintenance_plans_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenance_records` ADD CONSTRAINT `maintenance_records_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenance_records` ADD CONSTRAINT `maintenance_records_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `maintenance_records` ADD CONSTRAINT `maintenance_records_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `maintenance_plans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

