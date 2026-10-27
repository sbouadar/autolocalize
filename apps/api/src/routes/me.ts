import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";

const meRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", { preHandler: app.requireAuth }, async (request) => {
    const user = request.currentUser!;

    const tenant = user.tenantId
      ? await prisma.tenant.findUnique({
          where: { id: user.tenantId },
          select: {
            id: true,
            slug: true,
            name: true,
            address: true,
            phone: true,
            email: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
          },
        })
      : null;

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      tenant,
    };
  });
};

export default meRoutes;
