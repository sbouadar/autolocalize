import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const params = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,64}$/) });

// Branding minimal pour personnaliser la page /login/<slug> avant connexion.
// Ne renvoie aucune donnée sensible (pas d'adresse, ni de téléphone, ni de statut).
const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/public/tenants/:slug/branding",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = params.safeParse(request.params);
      if (!parsed.success) return reply.notFound();

      const tenant = await prisma.tenant.findUnique({
        where: { slug: parsed.data.slug },
        select: { name: true, logoUrl: true, primaryColor: true, secondaryColor: true, status: true },
      });
      // Même réponse pour un slug inconnu ou un client résilié : on ne révèle pas qui est client.
      if (!tenant || tenant.status === "CANCELLED") return reply.notFound();

      return {
        name: tenant.name,
        logoUrl: tenant.logoUrl,
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
      };
    },
  );
};

export default publicRoutes;
