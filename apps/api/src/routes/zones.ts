import type { FastifyBaseLogger, FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { tenantScope } from "../lib/fleet.js";
import { prisma } from "../lib/prisma.js";
import { firstIssue } from "../lib/tenant-branding.js";
import { traccar, TraccarError } from "../lib/traccar.js";

// Zones circulaires d'un client (dépôt, chantier, ville…). Tout utilisateur du client les voit ;
// seul son admin les modifie. Chaque zone surveille les véhicules qu'on lui affecte : eux seuls
// déclenchent une alerte en y entrant ou en en sortant. Notre base fait foi ; la zone et ses
// véhicules sont recopiés dans Traccar (geofence liée à chaque appareil), qui produit les événements.

export const ZONES_PER_TENANT = 50;
export const ZONES_PER_VEHICLE = 5;
const RADIUS_MIN_M = 50;
const RADIUS_MAX_M = 100_000;

/** Couleurs attribuées aux zones, dans l'ordre : la moins utilisée par le client est choisie. */
export const ZONE_COLORS = ["#2563EB", "#DC2626", "#16A34A", "#D97706", "#9333EA", "#0891B2", "#DB2777", "#4D7C0F"];

const zoneBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusM: z.number().int().min(RADIUS_MIN_M).max(RADIUS_MAX_M),
    /** Véhicules surveillés par la zone (aucun par défaut). */
    vehicleIds: z
      .array(z.string().regex(/^[a-z0-9]{1,64}$/))
      .max(500)
      .default([])
      .transform((ids) => [...new Set(ids)]),
  })
  .strict()
  // Le point 0,0 est la position envoyée par un traceur sans fix GPS : jamais une vraie zone.
  .refine((b) => b.latitude !== 0 || b.longitude !== 0, { message: "Position de la zone invalide" });

const idParams = z.object({ id: z.string().regex(/^[a-z0-9]{1,64}$/) });

const zoneSelect = {
  id: true,
  tenantId: true,
  name: true,
  latitude: true,
  longitude: true,
  radiusM: true,
  color: true,
  traccarGeofenceId: true,
  vehicles: { select: { vehicleId: true } },
} as const;

type ZoneRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  color: string;
  vehicles: { vehicleId: string }[];
};
const publicZone = ({ id, name, latitude, longitude, radiusM, color, vehicles }: ZoneRow) => ({
  id,
  name,
  latitude,
  longitude,
  radiusM,
  color,
  vehicleIds: vehicles.map((v) => v.vehicleId),
});

/** Zone demandée, si elle appartient au client connecté (sinon traitée comme inexistante). */
async function findOwnedZone(request: FastifyRequest) {
  const parsed = idParams.safeParse(request.params);
  if (!parsed.success) return null;
  return prisma.zone.findFirst({ where: { id: parsed.data.id, ...tenantScope(request.currentUser!) }, select: zoneSelect });
}

type Monitored = { id: string; name: string; traccarDeviceId: number };

/**
 * Véhicules demandés, s'ils appartiennent tous au client et ne dépassent pas la limite de zones par
 * véhicule (la zone en cours de modification n'est pas comptée). Sinon, un message pour l'utilisateur.
 */
async function resolveVehicles(
  tenantId: string,
  vehicleIds: string[],
  zoneId?: string,
): Promise<{ vehicles: Monitored[] } | { status: 400 | 409; error: string }> {
  if (vehicleIds.length === 0) return { vehicles: [] };
  const vehicles = await prisma.vehicle.findMany({
    where: { id: { in: vehicleIds }, tenantId },
    select: { id: true, name: true, traccarDeviceId: true, _count: { select: { zones: zoneId ? { where: { zoneId: { not: zoneId } } } : true } } },
  });
  if (vehicles.length !== vehicleIds.length) return { status: 400, error: "Véhicule inconnu" };
  const full = vehicles.find((v) => v._count.zones >= ZONES_PER_VEHICLE);
  if (full) return { status: 409, error: `« ${full.name} » est déjà surveillé par ${ZONES_PER_VEHICLE} zones (maximum)` };
  return { vehicles: vehicles.map(({ id, name, traccarDeviceId }) => ({ id, name, traccarDeviceId })) };
}

/** Lie la zone à l'appareil dans Traccar ; une liaison déjà présente (nouvel essai) n'est pas une erreur. */
async function link(deviceId: number, geofenceId: number, log: FastifyBaseLogger) {
  try {
    await traccar.linkGeofenceToDevice(deviceId, geofenceId);
  } catch (err) {
    if (!(err instanceof TraccarError) || err.status !== 400) throw err;
    log.warn({ deviceId, geofenceId }, "Liaison zone ↔ appareil refusée par Traccar (probablement déjà présente)");
  }
}

/** Couleur la moins utilisée par les zones du client. */
async function nextColor(tenantId: string): Promise<string> {
  const used = await prisma.zone.groupBy({ by: ["color"], where: { tenantId }, _count: true });
  const count = (color: string) => used.find((u) => u.color === color)?._count ?? 0;
  return ZONE_COLORS.reduce((best, color) => (count(color) < count(best) ? color : best));
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
    const { vehicleIds, ...data } = parsed.data;
    const tenantId = request.currentUser!.tenantId!;

    if ((await prisma.zone.count({ where: { tenantId } })) >= ZONES_PER_TENANT) {
      return reply.conflict(`Nombre maximal de zones atteint (${ZONES_PER_TENANT})`);
    }
    const monitored = await resolveVehicles(tenantId, vehicleIds);
    if ("error" in monitored) return reply.code(monitored.status).send({ statusCode: monitored.status, error: monitored.error });

    let geofenceId: number;
    try {
      geofenceId = (await traccar.createGeofence(data)).id;
    } catch (err) {
      request.log.error({ err }, "Échec de la création de la zone dans Traccar");
      return reply.serviceUnavailable("Les zones sont momentanément indisponibles");
    }

    let zone;
    try {
      for (const v of monitored.vehicles) await link(v.traccarDeviceId, geofenceId, request.log);
      zone = await prisma.zone.create({
        data: {
          ...data,
          tenantId,
          color: await nextColor(tenantId),
          traccarGeofenceId: geofenceId,
          vehicles: { create: monitored.vehicles.map((v) => ({ vehicleId: v.id })) },
        },
        select: zoneSelect,
      });
    } catch (err) {
      // Traccar et notre base doivent rester cohérents : on retire la geofence (et ses liaisons).
      await traccar.deleteGeofence(geofenceId).catch(() => request.log.warn({ geofenceId }, "Geofence Traccar orpheline"));
      request.log.error({ err }, "Échec de l'enregistrement de la zone");
      return reply.serviceUnavailable("Les zones sont momentanément indisponibles");
    }
    await audit(request, "zone.create", { tenantId, targetId: zone.id, details: { ...data, vehicles: monitored.vehicles.length } });
    return reply.code(201).send({ zone: publicZone(zone) });
  });

  app.put("/zones/:id", { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN")] }, async (request, reply) => {
    const existing = await findOwnedZone(request);
    if (!existing) return reply.notFound();
    const parsed = zoneBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const { vehicleIds, ...data } = parsed.data;

    const monitored = await resolveVehicles(existing.tenantId, vehicleIds, existing.id);
    if ("error" in monitored) return reply.code(monitored.status).send({ statusCode: monitored.status, error: monitored.error });

    const before = new Set(existing.vehicles.map((v) => v.vehicleId));
    const after = new Set(monitored.vehicles.map((v) => v.id));
    const added = monitored.vehicles.filter((v) => !before.has(v.id));
    const removed = await prisma.vehicle.findMany({
      where: { id: { in: [...before].filter((id) => !after.has(id)) } },
      select: { traccarDeviceId: true },
    });
    const geofenceId = existing.traccarGeofenceId;

    try {
      await traccar.updateGeofence(geofenceId, data);
      for (const v of added) await link(v.traccarDeviceId, geofenceId, request.log);
      for (const v of removed) await traccar.unlinkGeofenceFromDevice(v.traccarDeviceId, geofenceId);
    } catch (err) {
      request.log.error({ err }, "Échec de la modification de la zone dans Traccar");
      return reply.serviceUnavailable("Les zones sont momentanément indisponibles");
    }

    // Zones créées avant le choix des véhicules : elles étaient liées au groupe entier du client.
    const tenant = await prisma.tenant.findUnique({ where: { id: existing.tenantId }, select: { traccarGroupId: true } });
    if (tenant?.traccarGroupId) {
      await traccar.unlinkGeofenceFromGroup(tenant.traccarGroupId, geofenceId).catch(() => undefined);
    }

    const zone = await prisma.zone.update({
      where: { id: existing.id },
      data: { ...data, vehicles: { deleteMany: {}, create: monitored.vehicles.map((v) => ({ vehicleId: v.id })) } },
      select: zoneSelect,
    });
    await audit(request, "zone.update", {
      tenantId: existing.tenantId,
      targetId: zone.id,
      details: { ...data, vehicles: monitored.vehicles.length },
    });
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
