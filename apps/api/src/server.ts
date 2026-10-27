import { buildApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";

const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Arrêt en cours");
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
