-- M5 (plan des fonctions métier) : locataires (numéros de pièce chiffrés par l'API) et réservations.
-- Uniquement des créations de tables.
-- CreateTable
CREATE TABLE `customers` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `kind` ENUM('PERSON', 'COMPANY') NOT NULL DEFAULT 'PERSON',
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `email` VARCHAR(191) NULL,
    `address` VARCHAR(500) NULL,
    `birthDate` DATE NULL,
    `idDocumentType` ENUM('NATIONAL_ID', 'PASSPORT', 'RESIDENCE_PERMIT', 'OTHER') NULL,
    `idDocumentEnc` VARCHAR(255) NULL,
    `idDocumentLast4` VARCHAR(4) NULL,
    `idDocumentHash` CHAR(64) NULL,
    `licenseNumberEnc` VARCHAR(255) NULL,
    `licenseLast4` VARCHAR(4) NULL,
    `licenseExpiresOn` DATE NULL,
    `anonymizedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customers_tenantId_name_idx`(`tenantId`, `name`),
    INDEX `customers_tenantId_idDocumentHash_idx`(`tenantId`, `idDocumentHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rentals` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NULL,
    `vehicleName` VARCHAR(191) NOT NULL,
    `vehiclePlate` VARCHAR(32) NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `driverName` VARCHAR(191) NULL,
    `status` ENUM('RESERVED', 'ONGOING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'RESERVED',
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `pickedUpAt` DATETIME(3) NULL,
    `returnedAt` DATETIME(3) NULL,
    `odometerOutKm` INTEGER NULL,
    `odometerInKm` INTEGER NULL,
    `fuelOut` INTEGER NULL,
    `fuelIn` INTEGER NULL,
    `gpsDistanceKm` DOUBLE NULL,
    `price` DECIMAL(12, 2) NULL,
    `deposit` DECIMAL(12, 2) NULL,
    `allowedZoneId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rentals_tenantId_startAt_idx`(`tenantId`, `startAt`),
    INDEX `rentals_vehicleId_startAt_idx`(`vehicleId`, `startAt`),
    INDEX `rentals_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

