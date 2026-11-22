import { buildApp } from "./app.js";
import { config, invalidDataKeys } from "./config.js";
import { startScheduler, tasks } from "./jobs/scheduler.js";
import { dataKeysConfigured } from "./lib/crypto.js";
import { alertRulesTask } from "./lib/alert-rules.js";
import { deadlineAlertsTask } from "./lib/deadlines.js";
import { driverLicenseAlertsTask } from "./lib/drivers.js";
import { eventPurgeTask } from "./lib/event-purge.js";
import { maintenanceAlertsTask } from "./lib/maintenance.js";
import { overdueRentalsTask, unauthorizedUseTask } from "./lib/rental-alerts.js";
import { prisma } from "./lib/prisma.js";

const app = await buildApp();

if (invalidDataKeys.length > 0) {
  app.log.error({ keys: invalidDataKeys }, "Clés du module location mal formées (32 octets en base64 attendus) : ignorées");
}

// Module location activé pour un client sans les clés de chiffrement : démarrage refusé plutôt que
// de laisser des pièces d'identité illisibles ou impossibles à enregistrer.
if (!dataKeysConfigured() && (await prisma.tenant.count({ where: { rentalsEnabled: true } })) > 0) {
  throw new Error("DATA_ENCRYPTION_KEY et DATA_HASH_KEY sont requises : le module location est activé pour un client");
}

// Tâches quotidiennes par client : alertes d'échéances (M3).
tasks.daily.push(deadlineAlertsTask, maintenanceAlertsTask, driverLicenseAlertsTask, (ctx) => eventPurgeTask(ctx));
// Toutes les 5 minutes : alertes de location (retard, usage hors location).
tasks.frequent.push(overdueRentalsTask, unauthorizedUseTask, alertRulesTask);

// Tâche planifiée (alertes d'échéances, d'entretien, de location) : jamais pendant les tests.
const stopScheduler = config.NODE_ENV === "test" ? () => {} : startScheduler(app.log);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Arrêt en cours");
  stopScheduler();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
