import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { isoDate } from "../lib/deadlines.js";
import { DRIVER_READERS, requireDriversModule } from "../lib/drivers.js";
import { ALERT_TYPES } from "../lib/events.js";
import { reliableTrip } from "../lib/positions.js";
import { prisma } from "../lib/prisma.js";
import { lockVehicle } from "../lib/rentals.js";
import { firstIssue } from "../lib/tenant-branding.js";
import { knotsToKmh, traccar } from "../lib/traccar.js";
import { REPORT_RATE_LIMIT } from "./vehicles.js";

// Conducteurs et affectations (M8, module conducteurs). Lecture : tout utilisateur du client ;
// écriture : admin du client. 404 partout si le module n'est pas activé.

const DRIVERS_MAX = 500;
const ACTIVITY_MAX_DAYS = 31;
const HISTORY_MAX = 50;

const id = z.string().regex(/^[a-z0-9]{1,64}$/);
const idParam = z.object({ id });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= "2000-01-01";
  }, "Date invalide")
  .transform((v) => new Date(`${v}T00:00:00Z`));
const dateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

const fields = {
  name: z.string().trim().min(1, "name : nom obligatoire").max(191),
  phone: optionalText(32),
  email: z
    .string()
    .trim()
    .max(191)
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, "email : adresse invalide"),
  licenseNumber: optionalText(64),
  licenseExpiresOn: dateOnly.nullable(),
  notes: optionalText(500),
  active: z.boolean(),
};
const createBody = z.object(fields).partial().required({ name: true }).strict();
const updateBody = z.object(fields).partial().strict();
const assignBody = z
  .object({
    /** null : le véhicule n'a plus de conducteur. */
    driverId: id.nullable(),
    /** Instant du changement ; maintenant par défaut, jamais dans le futur. */
    at: dateTime.refine((d) => d.getTime() <= Date.now() + 60_000, "La date ne peut pas être dans le futur").optional(),
  })
  .strict();
const periodQuery = z.object({ from: dateTime, to: dateTime });

const driverSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  licenseNumber: true,
  licenseExpiresOn: true,
  notes: true,
  active: true,
  assignments: { where: { endAt: null }, select: { startAt: true, vehicle: { select: { id: true, name: true, plate: true } } }, take: 1 },
} as const;

type DriverRow = {
  licenseExpiresOn: Date | null;
  assignments: { startAt: Date; vehicle: { id: string; name: string; plate: string | null } }[];
} & Record<string, unknown>;

function publicDriver<T extends DriverRow>({ assignments, licenseExpiresOn, ...rest }: T) {
  const current = assignments[0];
  return {
    ...rest,
    licenseExpiresOn: licenseExpiresOn ? isoDate(licenseExpiresOn) : null,
    currentVehicle: current ? { ...current.vehicle, since: current.startAt.toISOString() } : null,
  };
}

const assignmentSelect = {
  id: true,
  startAt: true,
  endAt: true,
  driver: { select: { id: true, name: true } },
  vehicle: { select: { id: true, name: true, plate: true } },
} as const;

const driverRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);
  app.addHook("preHandler", app.requireRole(...DRIVER_READERS));
  app.addHook("preHandler", requireDriversModule);
  const adminOnly = app.requireRole("TENANT_ADMIN");
  const tenantOf = (request: FastifyRequest) => request.currentUser!.tenantId!;

  const findOwned = async (request: FastifyRequest) => {
    const parsed = idParam.safeParse(request.params);
    return parsed.success ? prisma.driver.findFirst({ where: { id: parsed.data.id, tenantId: tenantOf(request) }, select: driverSelect }) : null;
  };
  const findOwnedVehicle = async (request: FastifyRequest) => {
    const parsed = idParam.safeParse(request.params);
    return parsed.success
      ? prisma.vehicle.findFirst({ where: { id: parsed.data.id, tenantId: tenantOf(request) }, select: { id: true, name: true, traccarDeviceId: true } })
      : null;
  };

  app.get("/drivers", async (request) => {
    const includeInactive = (request.query as { includeInactive?: string }).includeInactive === "true";
    const rows = await prisma.driver.findMany({
      where: { tenantId: tenantOf(request), ...(!includeInactive && { active: true }) },
      select: driverSelect,
      orderBy: [{ active: "desc" }, { name: "asc" }],
      take: DRIVERS_MAX,
    });
    return { drivers: rows.map(publicDriver) };
  });

  app.post("/drivers", { preHandler: adminOnly }, async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = tenantOf(request);
    if ((await prisma.driver.count({ where: { tenantId } })) >= DRIVERS_MAX) return reply.conflict(`${DRIVERS_MAX} conducteurs au plus`);
    const row = await prisma.driver.create({ data: { ...parsed.data, tenantId }, select: driverSelect });
    // Le nom suffit au journal : pas de téléphone ni de numéro de permis.
    await audit(request, "driver.create", { tenantId, targetId: row.id, details: { name: row.name } });
    return reply.code(201).send({ driver: publicDriver(row) });
  });

  app.get("/drivers/:id", async (request, reply) => {
    const row = await findOwned(request);
    if (!row) return reply.notFound();
    const history = await prisma.driverAssignment.findMany({
      where: { driverId: row.id as string },
      select: assignmentSelect,
      orderBy: { startAt: "desc" },
      take: HISTORY_MAX,
    });
    return { driver: publicDriver(row), assignments: history };
  });

  app.put("/drivers/:id", { preHandler: adminOnly }, async (request, reply) => {
    const existing = await findOwned(request);
    if (!existing) return reply.notFound();
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = tenantOf(request);
    const row = await prisma.$transaction(async (tx) => {
      // Conducteur archivé : son affectation en cours prend fin.
      if (parsed.data.active === false) await tx.driverAssignment.updateMany({ where: { driverId: existing.id as string, endAt: null }, data: { endAt: new Date() } });
      return tx.driver.update({ where: { id: existing.id as string }, data: parsed.data, select: driverSelect });
    });
    await audit(request, "driver.update", { tenantId, targetId: row.id, details: { fields: Object.keys(parsed.data).sort() } });
    return { driver: publicDriver(row) };
  });

  // Suppression d'un conducteur sans historique (erreur de saisie) ; sinon, l'archiver.
  app.delete("/drivers/:id", { preHandler: adminOnly }, async (request, reply) => {
    const existing = await findOwned(request);
    if (!existing) return reply.notFound();
    if (await prisma.driverAssignment.count({ where: { driverId: existing.id as string } })) {
      return reply.code(409).send({ statusCode: 409, error: "Ce conducteur a un historique d'affectations : archivez-le plutôt", code: "DRIVER_HAS_HISTORY" });
    }
    await prisma.driver.delete({ where: { id: existing.id as string } });
    await audit(request, "driver.delete", { tenantId: tenantOf(request), targetId: existing.id as string, details: { name: existing.name } });
    return reply.code(204).send();
  });

  // Conducteur actuel du véhicule et historique.
  app.get("/vehicles/:id/driver", async (request, reply) => {
    const vehicle = await findOwnedVehicle(request);
    if (!vehicle) return reply.notFound();
    const history = await prisma.driverAssignment.findMany({
      where: { vehicleId: vehicle.id },
      select: assignmentSelect,
      orderBy: { startAt: "desc" },
      take: HISTORY_MAX,
    });
    const current = history.find((a) => a.endAt === null) ?? null;
    return { current, assignments: history };
  });

  // Changement de conducteur : l'affectation en cours du véhicule se termine, et celle du conducteur
  // choisi sur un autre véhicule aussi (un conducteur ne conduit qu'un véhicule à la fois).
  app.post("/vehicles/:id/driver", { preHandler: adminOnly }, async (request, reply) => {
    const vehicle = await findOwnedVehicle(request);
    if (!vehicle) return reply.notFound();
    const parsed = assignBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = tenantOf(request);
    const { driverId } = parsed.data;
    const at = parsed.data.at ?? new Date();
    if (driverId) {
      const driver = await prisma.driver.findFirst({ where: { id: driverId, tenantId }, select: { active: true } });
      if (!driver) return reply.badRequest("Conducteur inconnu");
      if (!driver.active) return reply.badRequest("Ce conducteur est archivé");
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockVehicle(tx, vehicle.id);
      const open = await tx.driverAssignment.findFirst({ where: { vehicleId: vehicle.id, endAt: null }, select: { id: true, driverId: true, startAt: true } });
      if (open && open.driverId === driverId) return { unchanged: true as const };
      const driverOpen = driverId
        ? await tx.driverAssignment.findFirst({ where: { driverId, endAt: null }, select: { id: true, startAt: true } })
        : null;
      // Un changement ne peut pas précéder le début des affectations qu'il termine, ni chevaucher l'historique.
      const latestStart = [open?.startAt, driverOpen?.startAt].filter((d): d is Date => d != null).sort((a, b) => b.getTime() - a.getTime())[0];
      if (latestStart && at <= latestStart) return { error: "La date doit être après le début de l'affectation en cours" };
      const later = await tx.driverAssignment.findFirst({
        where: { OR: [{ vehicleId: vehicle.id }, ...(driverId ? [{ driverId }] : [])], endAt: { gt: at } },
        select: { id: true },
      });
      if (later) return { error: "Une affectation enregistrée se termine après cette date : choisissez une date plus récente" };
      if (open) await tx.driverAssignment.update({ where: { id: open.id }, data: { endAt: at } });
      if (driverOpen) await tx.driverAssignment.update({ where: { id: driverOpen.id }, data: { endAt: at } });
      if (!driverId) return { current: null };
      const created = await tx.driverAssignment.create({
        data: { tenantId, driverId, vehicleId: vehicle.id, startAt: at, createdBy: request.currentUser!.id },
        select: assignmentSelect,
      });
      return { current: created };
    });
    if ("error" in result) return reply.badRequest(result.error);
    if ("unchanged" in result) {
      const current = await prisma.driverAssignment.findFirst({ where: { vehicleId: vehicle.id, endAt: null }, select: assignmentSelect });
      return { current };
    }
    await audit(request, "driver.assign", { tenantId, targetId: vehicle.id, details: { driverId, at } });
    return { current: result.current };
  });

  // Activité d'un conducteur sur une période : trajets et alertes des véhicules pendant ses affectations.
  app.get("/drivers/:id/activity", { config: REPORT_RATE_LIMIT }, async (request, reply) => {
    const driver = await findOwned(request);
    if (!driver) return reply.notFound();
    const parsed = periodQuery.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Période invalide");
    const { from, to } = parsed.data;
    if (to <= from) return reply.badRequest("La fin doit être après le début");
    if (to.getTime() - from.getTime() > ACTIVITY_MAX_DAYS * 86_400_000 + 3_600_000) return reply.badRequest(`Période de ${ACTIVITY_MAX_DAYS} jours au plus`);

    const spans = await prisma.driverAssignment.findMany({
      where: { driverId: driver.id as string, startAt: { lt: to }, OR: [{ endAt: null }, { endAt: { gt: from } }] },
      select: { startAt: true, endAt: true, vehicle: { select: { id: true, name: true, traccarDeviceId: true } } },
      orderBy: { startAt: "asc" },
    });
    const now = new Date();
    const segments = spans.map((s) => ({
      vehicle: s.vehicle,
      from: s.startAt > from ? s.startAt : from,
      to: new Date(Math.min((s.endAt ?? now).getTime(), to.getTime(), now.getTime())),
    })).filter((s) => s.to > s.from);

    let liveDataAvailable = true;
    const tripStats = await Promise.all(
      segments.map(async (s) => {
        try {
          // Un trajet compte pour le conducteur affecté à son départ.
          const trips = (await traccar.getReport("trips", [s.vehicle.traccarDeviceId], s.from, s.to)).filter((t) => {
            const start = Date.parse(t.startTime);
            return start >= s.from.getTime() && start < s.to.getTime();
          });
          const reliable = await Promise.all(trips.map((t) => reliableTrip(t, request.log)));
          return {
            trips: trips.length,
            meters: reliable.reduce((sum, t) => sum + (t?.distance ?? 0), 0),
            drivingMs: trips.reduce((sum, t) => sum + t.duration, 0),
            maxKnots: trips.reduce((max, t) => Math.max(max, t.maxSpeed), 0),
          };
        } catch (err) {
          request.log.error({ err }, "Échec du rapport de trajets Traccar (activité d'un conducteur)");
          liveDataAvailable = false;
          return null;
        }
      }),
    );
    const events = segments.length
      ? await prisma.event.findMany({
          where: { type: { in: ALERT_TYPES }, OR: segments.map((s) => ({ vehicleId: s.vehicle.id, eventTime: { gte: s.from, lt: s.to } })) },
          select: { type: true },
        })
      : [];
    const alerts: Record<string, number> = {};
    for (const e of events) alerts[e.type] = (alerts[e.type] ?? 0) + 1;
    const known = tripStats.filter((t) => t !== null);

    return {
      liveDataAvailable,
      trips: known.reduce((sum, t) => sum + t.trips, 0),
      distanceKm: Math.round(known.reduce((sum, t) => sum + t.meters, 0) / 100) / 10,
      drivingMs: known.reduce((sum, t) => sum + t.drivingMs, 0),
      maxSpeedKmh: knotsToKmh(known.reduce((max, t) => Math.max(max, t.maxKnots), 0)),
      alerts,
      segments: segments.map((s, i) => ({
        vehicleId: s.vehicle.id,
        vehicleName: s.vehicle.name,
        from: s.from.toISOString(),
        to: s.to.toISOString(),
        trips: tripStats[i]?.trips ?? null,
        distanceKm: tripStats[i] ? Math.round(tripStats[i]!.meters / 100) / 10 : null,
      })),
    };
  });
};

export default driverRoutes;
