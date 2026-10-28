import type { FastifyPluginAsync } from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { LOGO_FILE, logoDir, MIME_BY_EXT } from "../lib/logos.js";
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

  // Logos des clients (affichés sur la page de connexion, donc publics). Seuls les noms générés
  // par l'API sont acceptés : aucun chemin arbitraire ne peut être lu.
  app.get("/public/logos/:file", async (request, reply) => {
    const file = (request.params as { file?: string }).file ?? "";
    if (!LOGO_FILE.test(file)) return reply.notFound();
    let bytes: Buffer;
    try {
      bytes = await readFile(join(logoDir(), file));
    } catch {
      return reply.notFound();
    }
    return reply
      .header("Content-Type", MIME_BY_EXT[file.split(".")[1]!]!)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("Content-Security-Policy", "default-src 'none'")
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .send(bytes);
  });
};

export default publicRoutes;
