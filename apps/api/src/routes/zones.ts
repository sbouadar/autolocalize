import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { tenantScope } from "../lib/fleet.js";
import { prisma } from "../lib/prisma.js";
import { firstIssue } from "../lib/tenant-branding.js";
import { alignTenantDevices, ensureTenantGroup } from "../lib/tenant-group.js";
import { traccar } from "../lib/traccar.js";

// Zones circulaires d'un client (dépôt, chantier…). Tout utilisateur du client les voit ; seul son
// admin les modifie. Notre base fait foi : chaque zone est recopiée dans Traccar (geofence liée au
// groupe du client), qui produit les événements d'entrée et de sortie.

export const ZONES_PER_TENANT = 50;
const RADIUS_MIN_M = 50;
const RADIUS_MAX_M = 100_000;

const zoneBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusM: z.number().int().min(RADIUS_MIN_M).max(RADIUS_MAX_M),
  })
  .strict()
  // Le point 0,0 est la position envoyée par un traceur sans fix GPS : jamais une vraie zone.
  .refine((b) => b.latitude !== 0 || b.longitude !== 0, { message: "Position de la zone invalide" });

const idParams = z.object({ id: z.string().regex(/^[a-z0-9]{1,64}$/) });

const zoneSelect = { id: true, tenantId: true, name: true, latitude: true, longitude: true, radiusM: true, traccarGeofenceId: true } as const;

type ZoneRow = { id: string; name: string; latitude: number; longitude: number; radiusM: number };
const publicZone = ({ id, name, latitude, longitude, radiusM }: ZoneRow) => ({ id, name, latitude, longitude, radiusM });

/** Zone demandée, si elle appartient au client connecté (sinon traitée comme inexistante). */
async function findOwnedZone(request: FastifyRequest) {
  const parsed = idParams.safeParse(request.params);
  if (!parsed.success) return null;
  return prisma.zone.findFirst({ where: { id: parsed.data.id, ...tenantScope(request.currentUser!) }, select: zoneSelect });
}

const zoneRoutes: FastifyPluginAsync = async (app) => {
  app.get("/zones", { preHandler: app.requireAuth }, async (request) => {
    const zones = await prisma.zone.findMany({
      where: tenantScope(request.currentUser!),
      select: zoneSelect,
      orderBy: { name: "asc" },
    });
    return { canEdit: request.currentUser!.role === "TENANT_ADMIN", zones: zones.map(publicZone) };
  });

  app.post("/zones", { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN")] }, async (request, reply) => {
    const parsed = zoneBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = request.currentUser!.tenantId!;

    if ((await prisma.zone.count({ where: { tenantId } })) >= ZONES_PER_TENANT) {
      return reply.conflict(`Nombre maximal de zones atteint (${ZONES_PER_TENANT})`);
    }
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true, traccarGroupId: true },
    });

    let geofenceId: number;
    try {
      const groupId = await ensureTenantGroup(tenant, request.log);
      await alignTenantDevices(tenantId, groupId);
      geofenceId = (await traccar.createGeofence(parsed.data)).id;
      await traccar.linkGeofenceToGroup(groupId, geofenceId);
    } catch (err) {
      request.log.error({ err }, "Échec de la création de la zone dans Traccar");
      return reply.serviceUnavailable("Les zones sont momentanément indisponibles");
    }

    let zone;
    try {
      zone = await prisma.zone.create({ data: { ...parsed.data, tenantId, traccarGeofenceId: geofenceId }, select: zoneSelect });
    } catch (err) {
      // Traccar et notre base doivent rester cohérents : on retire la geofence orpheline.
      await traccar.deleteGeofence(geofenceId).catch(() => request.log.warn({ geofenceId }, "Geofence Traccar orpheline"));
      throw err;
    }
    await audit(request, "zone.create", { tenantId, targetId: zone.id, details: parsed.data });
    return reply.code(201).send({ zone: publicZone(zone) });
  });

  app.put("/zones/:id", { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN")] }, async (request, reply) => {
    const existing = await findOwnedZone(request);
    if (!existing) return reply.notFound();
    const parsed = zoneBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));

    try {
      await traccar.updateGeofence(existing.traccarGeofenceId, parsed.data);
    } catch (err) {
      request.log.error({ err }, "Échec de la modification de la zone dans Traccar");
      return reply.serviceUnavailable("Les zones sont momentanément indisponibles");
    }
    const zone = await prisma.zone.update({ where: { id: existing.id }, data: parsed.data, select: zoneSelect });
    await audit(request, "zone.update", { tenantId: existing.tenantId, targetId: zone.id, details: parsed.data });
    return { zone: publicZone(zone) };
  });

  app.delete("/zones/:id", { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN")] }, async (request, reply) => {
    const existing = await findOwnedZone(request);
    if (!existing) return reply.notFound();

    // Traccar d'abord : une geofence restée active continuerait de produire des événements.
    try {
      await traccar.deleteGeofence(existing.traccarGeofenceId);
    } catch (err) {
      request.log.error({ err }, "Échec de la suppression de la zone dans Traccar");
      return reply.serviceUnavailable("Les zones sont momentanément indisponibles");
    }
    await prisma.zone.delete({ where: { id: existing.id } });
    await audit(request, "zone.delete", { tenantId: existing.tenantId, targetId: existing.id, details: { name: existing.name } });
    return reply.code(204).send();
  });
};

export default zoneRoutes;
