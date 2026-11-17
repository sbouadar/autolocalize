-- AlterTable : statut « UNCERTAIN » (commande partie vers Traccar, réponse jamais reçue).
ALTER TABLE `command_log` MODIFY `status` ENUM('SENT', 'REJECTED', 'FAILED', 'UNCERTAIN') NOT NULL;
