import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "db_unavailable" });
    }
  });
};

export default healthRoutes;
