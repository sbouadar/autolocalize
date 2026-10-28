import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { config, isProduction } from "./config.js";
import authContext from "./plugins/auth-context.js";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";
import commandRoutes from "./routes/commands.js";
import dashboardRoutes from "./routes/dashboard.js";
import healthRoutes from "./routes/health.js";
import meRoutes from "./routes/me.js";
import publicRoutes from "./routes/public.js";
import tenantRoutes from "./routes/tenant.js";
import vehicleRoutes from "./routes/vehicles.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(!isProduction && { transport: { target: "pino-pretty" } }),
      // Ne jamais journaliser les cookies ni les jetons.
      redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
    },
    // Derrière Nginx : l'IP du client vient de X-Forwarded-For.
    trustProxy: "127.0.0.1",
  });

  await app.register(helmet);
  if (config.CORS_ORIGINS.length > 0) {
    await app.register(cors, {
      origin: config.CORS_ORIGINS,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE"],
      exposedHeaders: ["set-auth-token"],
    });
  }
  await app.register(sensible);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(authContext);

  // Les erreurs 5xx sont journalisées en détail mais jamais renvoyées telles quelles au client.
  app.setErrorHandler((error: { statusCode?: number; message: string }, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, "Erreur interne");
      return reply.code(status).send({ statusCode: status, error: "Internal Server Error" });
    }
    return reply.code(status).send({ statusCode: status, error: error.message });
  });

  // Tout le backend est servi sous /api (autolocalize.net/api/...).
  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(publicRoutes);
      await api.register(meRoutes);
      await api.register(vehicleRoutes);
      await api.register(commandRoutes);
      await api.register(dashboardRoutes);
      await api.register(tenantRoutes);
      await api.register(adminRoutes);
    },
    { prefix: "/api" },
  );

  return app;
}
