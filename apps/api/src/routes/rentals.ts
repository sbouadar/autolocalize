import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { readDamages } from "../lib/car-diagram.js";
import { prisma } from "../lib/prisma.js";
import {
  ACTIVE_RENTAL_STATUSES,
  findConflict,
  lockVehicle,
  RENTAL_READERS,
  RENTAL_WRITERS,
  requireRentalsModule,
  type Conflict,
} from "../lib/rentals.js";
import { firstIssue } from "../lib/tenant-branding.js";

// Réservations et locations (M5). Lecture : tout utilisateur du client ; écriture : admin et agents.
// Le client vient de la session. Le départ et le retour du véhicule arrivent avec M6.

const RENTAL_MAX_DAYS = 366;
const LIST_MAX = 500;

const dateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const id = z.string().regex(/^[a-z0-9]{1,64}$/);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));
/** Montant positif, 2 décimales au plus, dans la devise du client. */
const amount = z
  .number()
  .min(0)
  .max(99_999_999)
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "2 décimales au plus")
  .transform((n) => n.toFixed(2))
  .nullable();

const fields = {
  vehicleId: id,
  customerId: id,
  startAt: dateTime,
  endAt: dateTime,
  driverName: optionalText(191),
  price: amount,
  deposit: amount,
  allowedZoneId: id.nullable(),
  pickupLocation: optionalText(191),
  returnLocation: optionalText(191),
  notes: optionalText(2000),
};

const createBody = z.object(fields).partial().required({ vehicleId: true, customerId: true, startAt: true, endAt: true }).strict();
const updateBody = z.object(fields).partial().strict();

const listQuery = z.object({
  from: dateTime.optional(),
  to: dateTime.optional(),
  vehicleId: id.optional(),
  customerId: id.optional(),
  status: z.enum(["RESERVED", "ONGOING", "COMPLETED", "CANCELLED"]).optional(),
});
const availabilityQuery = z.object({ from: dateTime, to: dateTime });
const idParam = z.object({ id });

export const rentalSelect = {
  id: true,
  status: true,
  vehicleId: true,
  vehicleName: true,
  vehiclePlate: true,
  customerId: true,
  customer: { select: { name: true, phone: true } },
  driverName: true,
  startAt: true,
  endAt: true,
  pickedUpAt: true,
  returnedAt: true,
  odometerOutKm: true,
  odometerInKm: true,
  fuelOut: true,
  fuelIn: true,
  damagesOut: true,
  damagesIn: true,
  gpsDistanceKm: true,
  price: true,
  deposit: true,
  allowedZoneId: true,
  pickupLocation: true,
  returnLocation: true,
  notes: true,
  cancelledAt: true,
  createdAt: true,
  tenant: { select: { currency: true } },
} as const;

type RentalRow = Awaited<ReturnType<typeof prisma.rental.findFirstOrThrow<{ select: typeof rentalSelect }>>>;

export function publicRental(row: RentalRow, now = new Date()) {
  const { customer, tenant, price, deposit, damagesOut, damagesIn, ...rest } = row;
  return {
    ...rest,
    damagesOut: readDamages(damagesOut),
    damagesIn: readDamages(damagesIn),
    customerName: customer.name,
    customerPhone: customer.phone,
    // Montants en chaînes (« 350.00 ») pour ne rien perdre en virgule flottante.
    price: price?.toFixed(2) ?? null,
    deposit: deposit?.toFixed(2) ?? null,
    currency: tenant.currency,
    /** Location en cours dont la fin prévue est dépassée. */
    late: row.status === "ONGOING" && row.endAt < now,
  };
}

function conflictReply(reply: FastifyReply, conflict: NonNullable<Conflict>) {
  return reply.code(409).send({ statusCode: 409, error: conflict.message, code: conflict.code });
}

function periodError(startAt: Date, endAt: Date): string | null {
  if (endAt <= startAt) return "La fin doit être après le début";
  if (endAt.getTime() - startAt.getTime() > RENTAL_MAX_DAYS * 86_400_000) return `Une location dure ${RENTAL_MAX_DAYS} jours au plus`;
  return null;
}

const rentalRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);
  app.addHook("preHandler", app.requireRole(...RENTAL_READERS));
  app.addHook("preHandler", requireRentalsModule);
  const writers = app.requireRole(...RENTAL_WRITERS);

  const tenantOf = (request: FastifyRequest) => request.currentUser!.tenantId!;

  const findOwned = async (request: FastifyRequest) => {
    const parsed = idParam.safeParse(request.params);
    return parsed.success
      ? prisma.rental.findFirst({ where: { id: parsed.data.id, tenantId: tenantOf(request) }, select: rentalSelect })
      : null;
  };

  /** Zone autorisée : doit appartenir au client. */
  const zoneExists = async (tenantId: string, zoneId: string | null | undefined) =>
    !zoneId || Boolean(await prisma.zone.findFirst({ where: { id: zoneId, tenantId }, select: { id: true } }));

  // Locations qui recoupent la période [from, to] (par défaut : des 30 derniers jours à l'avenir).
  app.get("/rentals", async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Paramètres invalides");
    const { from = new Date(Date.now() - 30 * 86_400_000), to, vehicleId, customerId, status } = parsed.data;
    const rows = await prisma.rental.findMany({
      where: {
        tenantId: tenantOf(request),
        endAt: { gt: from },
        ...(to && { startAt: { lt: to } }),
        ...(vehicleId && { vehicleId }),
        ...(customerId && { customerId }),
        ...(status && { status }),
      },
      select: rentalSelect,
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      take: LIST_MAX,
    });
    const now = new Date();
    return { rentals: rows.map((r) => publicRental(r, now)) };
  });

  // Véhicules du client et leur disponibilité sur une période : les libres d'abord, puis les
  // indisponibles avec leur motif. Période entièrement passée (ancienne réservation à reprendre) :
  // tous les véhicules sont proposés, sans contrôle.
  app.get("/vehicles/availability", async (request, reply) => {
    const parsed = availabilityQuery.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Période invalide");
    const { from, to } = parsed.data;
    const error = periodError(from, to);
    if (error) return reply.badRequest(error);
    const tenantId = tenantOf(request);
    const past = to <= new Date();

    const [vehicles, rentals, unavailabilities] = await Promise.all([
      prisma.vehicle.findMany({ where: { tenantId }, select: { id: true, name: true, plate: true }, orderBy: { name: "asc" } }),
      past
        ? []
        : prisma.rental.findMany({
            where: { tenantId, status: { in: [...ACTIVE_RENTAL_STATUSES] }, startAt: { lt: to }, endAt: { gt: from } },
            select: { vehicleId: true },
          }),
      past
        ? []
        : prisma.vehicleUnavailability.findMany({
            where: { tenantId, startAt: { lt: to }, OR: [{ endAt: null }, { endAt: { gt: from } }] },
            select: { vehicleId: true, reason: true },
            orderBy: { startAt: "asc" },
          }),
    ]);
    const rented = new Set(rentals.map((r) => r.vehicleId));
    // Plusieurs indisponibilités sur la période : le motif de la première.
    const unavailable = new Map<string, (typeof unavailabilities)[number]["reason"]>();
    for (const u of unavailabilities) if (!unavailable.has(u.vehicleId)) unavailable.set(u.vehicleId, u.reason);
    const list = vehicles.map((v) => ({
      ...v,
      available: !rented.has(v.id) && !unavailable.has(v.id),
      reason: rented.has(v.id) ? "RENTED" : unavailable.has(v.id) ? "UNAVAILABLE" : null,
      /** Motif de l'indisponibilité (entretien, réparation, accident, autre) quand ce n'est pas une location. */
      unavailabilityReason: rented.has(v.id) ? null : (unavailable.get(v.id) ?? null),
    }));
    // Tri stable : l'ordre alphabétique est conservé dans chaque groupe.
    return { past, vehicles: [...list.filter((v) => v.available), ...list.filter((v) => !v.available)] };
  });

  app.post("/rentals", { preHandler: writers }, async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = tenantOf(request);
    const { vehicleId, customerId, startAt, endAt, ...rest } = parsed.data;
    const error = periodError(startAt, endAt);
    if (error) return reply.badRequest(error);
    // Une période passée est acceptée : une ancienne réservation peut être reprise dans le système,
    // sans contrôle de disponibilité (tous les véhicules sont alors proposés).
    const past = endAt <= new Date();

    // Véhicule et locataire du client connecté ; ceux d'un autre client sont traités comme inexistants.
    const [vehicle, customer] = await Promise.all([
      prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId }, select: { id: true, name: true, plate: true } }),
      prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true, anonymizedAt: true } }),
    ]);
    if (!vehicle) return reply.badRequest("Véhicule inconnu");
    if (!customer) return reply.badRequest("Locataire inconnu");
    if (customer.anonymizedAt) return reply.badRequest("Ce locataire a été anonymisé");
    if (!(await zoneExists(tenantId, rest.allowedZoneId))) return reply.badRequest("Zone inconnue");

    const result = await prisma.$transaction(async (tx) => {
      await lockVehicle(tx, vehicle.id);
      const conflict = past ? null : await findConflict(tx, vehicle.id, startAt, endAt);
      if (conflict) return { conflict };
      const row = await tx.rental.create({
        data: {
          ...rest,
          tenantId,
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          vehiclePlate: vehicle.plate,
          customerId: customer.id,
          startAt,
          endAt,
          createdBy: request.currentUser!.id,
        },
        select: rentalSelect,
      });
      return { row };
    });
    if ("conflict" in result) return conflictReply(reply, result.conflict!);

    await audit(request, "rental.create", {
      tenantId,
      targetId: result.row.id,
      details: { vehicleId: vehicle.id, customerId: customer.id, startAt, endAt },
    });
    return reply.code(201).send({ rental: publicRental(result.row) });
  });

  app.get("/rentals/:id", async (request, reply) => {
    const row = await findOwned(request);
    if (!row) return reply.notFound();
    return { rental: publicRental(row) };
  });

  // Modification : tout tant que la location est réservée ; une fois le véhicule parti, seulement la
  // fin prévue (prolongation), le prix, la caution, la zone et les notes ; plus rien une fois terminée.
  app.put("/rentals/:id", { preHandler: writers }, async (request, reply) => {
    const existing = await findOwned(request);
    if (!existing) return reply.notFound();
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = tenantOf(request);
    const data = parsed.data;

    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
      return reply.code(409).send({ statusCode: 409, error: "Cette location est terminée ou annulée", code: "RENTAL_CLOSED" });
    }
    if (existing.status === "ONGOING" && (data.vehicleId || data.customerId || data.startAt)) {
      return reply.code(409).send({
        statusCode: 409,
        error: "Le véhicule est déjà parti : le véhicule, le locataire et le début ne peuvent plus changer",
        code: "RENTAL_STARTED",
      });
    }

    const startAt = data.startAt ?? existing.startAt;
    const endAt = data.endAt ?? existing.endAt;
    const error = periodError(startAt, endAt);
    if (error) return reply.badRequest(error);
    if (!(await zoneExists(tenantId, data.allowedZoneId))) return reply.badRequest("Zone inconnue");

    const vehicleId = data.vehicleId ?? existing.vehicleId;
    if (!vehicleId) return reply.badRequest("Le véhicule de cette location a été retiré : choisissez-en un autre");
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId }, select: { id: true, name: true, plate: true } });
    if (!vehicle) return reply.badRequest("Véhicule inconnu");
    if (data.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: data.customerId, tenantId }, select: { anonymizedAt: true } });
      if (!customer) return reply.badRequest("Locataire inconnu");
      if (customer.anonymizedAt) return reply.badRequest("Ce locataire a été anonymisé");
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockVehicle(tx, vehicle.id);
      const conflict = await findConflict(tx, vehicle.id, startAt, endAt, existing.id);
      if (conflict) return { conflict };
      const row = await tx.rental.update({
        where: { id: existing.id },
        data: { ...data, ...(data.vehicleId && { vehicleName: vehicle.name, vehiclePlate: vehicle.plate }) },
        select: rentalSelect,
      });
      return { row };
    });
    if ("conflict" in result) return conflictReply(reply, result.conflict!);

    await audit(request, "rental.update", { tenantId, targetId: existing.id, details: { fields: Object.keys(data).sort() } });
    return { rental: publicRental(result.row) };
  });

  app.post("/rentals/:id/cancel", { preHandler: writers }, async (request, reply) => {
    const existing = await findOwned(request);
    if (!existing) return reply.notFound();
    if (existing.status === "CANCELLED") return { rental: publicRental(existing) };
    if (existing.status !== "RESERVED") {
      return reply.code(409).send({
        statusCode: 409,
        error: "Seule une réservation dont le véhicule n'est pas encore parti peut être annulée",
        code: "RENTAL_NOT_CANCELLABLE",
      });
    }
    const row = await prisma.rental.update({
      where: { id: existing.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
      select: rentalSelect,
    });
    await audit(request, "rental.cancel", { tenantId: tenantOf(request), targetId: existing.id });
    return { rental: publicRental(row) };
  });
};

export default rentalRoutes;
