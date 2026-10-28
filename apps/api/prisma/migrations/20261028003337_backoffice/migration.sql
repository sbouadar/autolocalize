-- AlterTable
ALTER TABLE `user` ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `tenantId` VARCHAR(64) NULL,
    `targetId` VARCHAR(64) NULL,
    `details` TEXT NULL,
    `ipAddress` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `audit_log_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
