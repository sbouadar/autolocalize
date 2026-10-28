import type { FastifyPluginAsync } from "fastify";
import { audit } from "../lib/audit.js";
import { clearLogo, decodeLogo, LOGO_ERRORS, logoBody, replaceLogo } from "../lib/logos.js";
import { prisma } from "../lib/prisma.js";
import { brandingBody, firstIssue, tenantPublicSelect } from "../lib/tenant-branding.js";

// Branding modifiable par l'admin du client, sur son seul client (jamais celui d'un autre :
// l'identifiant vient de la session, pas de la requête). Statut et identifiant restent au super-admin.
const tenantRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);
  app.addHook("preHandler", app.requireRole("TENANT_ADMIN"));

  app.put("/tenant/branding", async (request, reply) => {
    const parsed = brandingBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = request.currentUser!.tenantId!;

    const tenant = await prisma.tenant.update({ where: { id: tenantId }, data: parsed.data, select: tenantPublicSelect });
    await audit(request, "branding.update", { tenantId, targetId: tenantId, details: parsed.data });
    return { tenant };
  });

  app.post("/tenant/logo", { bodyLimit: 1_000_000 }, async (request, reply) => {
    const parsed = logoBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(LOGO_ERRORS.too_large);
    const logo = decodeLogo(parsed.data.data);
    if ("error" in logo) return reply.badRequest(LOGO_ERRORS[logo.error]);

    const tenantId = request.currentUser!.tenantId!;
    const logoUrl = await replaceLogo(tenantId, logo.bytes, logo.type.ext);
    await audit(request, "tenant.logo.set", { tenantId, targetId: tenantId, details: { bytes: logo.bytes.length, type: logo.type.mime } });
    return { logoUrl };
  });

  app.delete("/tenant/logo", async (request, reply) => {
    const tenantId = request.currentUser!.tenantId!;
    await clearLogo(tenantId);
    await audit(request, "tenant.logo.remove", { tenantId, targetId: tenantId });
    return reply.code(204).send();
  });
};

export default tenantRoutes;
