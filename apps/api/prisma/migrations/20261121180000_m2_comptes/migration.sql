-- M2 (plan des fonctions métier) : rôle AGENT et désactivation d'un compte par l'admin du client.
-- Uniquement des ajouts (nouvelle valeur d'énumération, colonne facultative).
-- AlterTable
ALTER TABLE `user` ADD COLUMN `disabledAt` DATETIME(3) NULL,
    MODIFY `role` ENUM('SUPER_ADMIN', 'TENANT_ADMIN', 'AGENT', 'VIEWER') NOT NULL DEFAULT 'VIEWER';

