-- DropForeignKey
ALTER TABLE `command_log` DROP FOREIGN KEY `command_log_vehicleId_fkey`;

-- AlterTable
ALTER TABLE `command_log` ADD COLUMN `traccarDeviceId` INTEGER NULL,
    ADD COLUMN `vehicleName` VARCHAR(191) NULL,
    MODIFY `vehicleId` VARCHAR(191) NULL;

-- Entrées existantes : copie du nom du véhicule et du traceur visés.
UPDATE `command_log` c JOIN `vehicles` v ON v.`id` = c.`vehicleId`
SET c.`vehicleName` = v.`name`, c.`traccarDeviceId` = v.`traccarDeviceId`;

-- AddForeignKey
ALTER TABLE `command_log` ADD CONSTRAINT `command_log_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
