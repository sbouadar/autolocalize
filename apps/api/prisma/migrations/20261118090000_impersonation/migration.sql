-- AlterTable : client au nom duquel un super-admin agit pendant cette session (« se connecter en tant que »).
ALTER TABLE `session` ADD COLUMN `actingTenantId` VARCHAR(191) NULL;
