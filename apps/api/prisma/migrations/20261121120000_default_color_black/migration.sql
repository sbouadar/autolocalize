-- AlterTable : noir adouci comme couleur par défaut d'un nouveau client (refonte visuelle du 2026-11-21).
ALTER TABLE `tenants` MODIFY `primaryColor` VARCHAR(7) NOT NULL DEFAULT '#141414';

-- Clients restés sur l'ancien bleu par défaut : passage au noir. Une couleur choisie par un client n'est pas touchée.
UPDATE `tenants` SET `primaryColor` = '#141414' WHERE `primaryColor` = '#1E3A8A';
