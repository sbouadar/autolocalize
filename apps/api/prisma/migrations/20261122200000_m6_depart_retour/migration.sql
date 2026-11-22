-- M6 (plan des fonctions métier) : photos d'état des lieux, contrat PDF figé, conditions générales.
-- Uniquement des ajouts (deux tables, une colonne facultative).
-- AlterTable
ALTER TABLE `tenants` ADD COLUMN `rentalTerms` TEXT NULL;

-- CreateTable
CREATE TABLE `rental_photos` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `rentalId` VARCHAR(191) NOT NULL,
    `phase` ENUM('PICKUP', 'RETURN') NOT NULL,
    `fileName` VARCHAR(64) NOT NULL,
    `mimeType` VARCHAR(32) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `caption` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_photos_rentalId_idx`(`rentalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_contracts` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `rentalId` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(64) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rental_contracts_rentalId_key`(`rentalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `rental_photos` ADD CONSTRAINT `rental_photos_rentalId_fkey` FOREIGN KEY (`rentalId`) REFERENCES `rentals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_contracts` ADD CONSTRAINT `rental_contracts_rentalId_fkey` FOREIGN KEY (`rentalId`) REFERENCES `rentals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

