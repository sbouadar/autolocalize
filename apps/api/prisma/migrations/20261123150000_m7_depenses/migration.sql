-- M7 (plan des fonctions métier) : dépenses des véhicules.
-- Uniquement la création d'une table.
-- CreateTable
CREATE TABLE `expenses` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `spentOn` DATE NOT NULL,
    `category` ENUM('FUEL', 'MAINTENANCE', 'REPAIR', 'INSURANCE', 'TAX', 'TOLL', 'FINE', 'PARKING', 'CLEANING', 'OTHER') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `liters` DOUBLE NULL,
    `km` INTEGER NULL,
    `maintenanceRecordId` VARCHAR(191) NULL,
    `notes` VARCHAR(500) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `expenses_vehicleId_spentOn_idx`(`vehicleId`, `spentOn`),
    INDEX `expenses_tenantId_spentOn_idx`(`tenantId`, `spentOn`),
    INDEX `expenses_maintenanceRecordId_idx`(`maintenanceRecordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_maintenanceRecordId_fkey` FOREIGN KEY (`maintenanceRecordId`) REFERENCES `maintenance_records`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
