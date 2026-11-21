import { buildApp } from "./app.js";
import { config } from "./config.js";
import { startScheduler, tasks } from "./jobs/scheduler.js";
import { deadlineAlertsTask } from "./lib/deadlines.js";
import { prisma } from "./lib/prisma.js";

const app = await buildApp();

// Tâches quotidiennes par client : alertes d'échéances (M3).
tasks.daily.push(deadlineAlertsTask);

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
