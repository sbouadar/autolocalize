import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { tenantScope } from "../lib/fleet.js";
import { prisma } from "../lib/prisma.js";
import { firstIssue } from "../lib/tenant-branding.js";
import { findOwnedVehicle } from "./vehicles.js";

// Indisponibilités des véhicules (M3) : lecture par tous, écriture par l'admin et les agents du client.

export const UNAVAILABILITY_REASONS = ["MAINTENANCE", "REPAIR", "ACCIDENT", "OTHER"] as const;
const WRITERS = ["TENANT_ADMIN", "AGENT"] as const;

const dateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

const fields = {
  startAt: dateTime,
  endAt: dateTime.nullable(),
  reason: z.enum(UNAVAILABILITY_REASONS),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((v) => (v ? v : null)),
};

const createBody = z.object({ ...fields, endAt: fields.endAt.optional(), notes: fields.notes.optional() }).strict();
const updateBody = z.object(fields).partial().strict();
const idParam = z.object({ id: z.string().regex(/^[a-z0-9]{1,64}$/) });

const select = {
  id: true,
  vehicleId: true,
  startAt: true,
  endAt: true,
  reason: true,
  notes: true,
  vehicle: { select: { name: true, plate: true } },
} as const;

type Row = {
  id: string;
  vehicleId: string;
  startAt: Date;
  endAt: Date | null;
  reason: string;
  notes: string | null;
  vehicle: { name: string; plate: string | null };
};

function publicRow(row: Row, now = new Date()) {
  const { vehicle, ...rest } = row;
  return {
    ...rest,
    vehicleName: vehicle.name,
    vehiclePlate: vehicle.plate,
    /** En cours à cet instant. */
    current: row.startAt <= now && (row.endAt === null || row.endAt > now),
    /** Terminée (ni en cours, ni à venir). */
    past: row.endAt !== null && row.endAt <= now,
  };
}

const invalidPeriod = (startAt: Date, endAt: Date | null) => endAt !== null && endAt <= startAt;

const unavailabilityRoutes: FastifyPluginAsync = async (app) => {
  // Indisponibilités en cours de toute la flotte (tableau de bord).
  app.get("/unavailabilities/current", { preHandler: app.requireAuth }, async (request) => {
    const now = new Date();
    const rows = await prisma.vehicleUnavailability.findMany({
      where: { ...tenantScope(request.currentUser!), startAt: { lte: now }, OR: [{ endAt: null }, { endAt: { gt: now } }] },
      select,
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      take: 200,
    });
    return { unavailabilities: rows.map((r) => publicRow(r, now)) };
  });

  // Indisponibilités d'un véhicule : en cours et à venir, puis les 20 dernières passées.
  app.get("/vehicles/:id/unavailabilities", { preHandler: app.requireAuth }, async (request, reply) => {
    const vehicle = await findOwnedVehicle(request);
    if (!vehicle) return reply.notFound();
    const now = new Date();
    const [open, past] = await Promise.all([
      prisma.vehicleUnavailability.findMany({
        where: { vehicleId: vehicle.id, OR: [{ endAt: null }, { endAt: { gt: now } }] },
        select,
        orderBy: [{ startAt: "asc" }, { id: "asc" }],
      }),
      prisma.vehicleUnavailability.findMany({
        where: { vehicleId: vehicle.id, endAt: { lte: now } },
        select,
        orderBy: [{ endAt: "desc" }, { id: "desc" }],
        take: 20,
      }),
    ]);
    return { unavailabilities: [...open, ...past].map((r) => publicRow(r, now)) };
  });

  app.post(
    "/vehicles/:id/unavailabilities",
    { preHandler: [app.requireAuth, app.requireRole(...WRITERS)] },
    async (request, reply) => {
      const vehicle = await findOwnedVehicle(request);
      if (!vehicle) return reply.notFound();
      const parsed = createBody.safeParse(request.body);
      if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
      const { startAt, endAt = null, reason, notes = null } = parsed.data;
      if (invalidPeriod(startAt, endAt)) return reply.badRequest("La fin doit être après le début");

      const row = await prisma.vehicleUnavailability.create({
        data: { tenantId: vehicle.tenantId, vehicleId: vehicle.id, startAt, endAt, reason, notes, createdBy: request.currentUser!.id },
        select,
      });
      await audit(request, "unavailability.create", {
        tenantId: vehicle.tenantId,
        targetId: row.id,
        details: { vehicleId: vehicle.id, reason, startAt, endAt },
      });
      return reply.code(201).send({ unavailability: publicRow(row) });
    },
  );

  /** Indisponibilité du client connecté ; celle d'un autre client est traitée comme inexistante. */
  const findOwned = async (params: unknown, tenantId: string) => {
    const parsed = idParam.safeParse(params);
    return parsed.success ? prisma.vehicleUnavailability.findFirst({ where: { id: parsed.data.id, tenantId }, select }) : null;
  };

  app.put("/unavailabilities/:id", { preHandler: [app.requireAuth, app.requireRole(...WRITERS)] }, async (request, reply) => {
    const tenantId = request.currentUser!.tenantId!;
    const existing = await findOwned(request.params, tenantId);
    if (!existing) return reply.notFound();
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const startAt = parsed.data.startAt ?? existing.startAt;
    const endAt = parsed.data.endAt !== undefined ? parsed.data.endAt : existing.endAt;
    if (invalidPeriod(startAt, endAt)) return reply.badRequest("La fin doit être après le début");

    const row = await prisma.vehicleUnavailability.update({ where: { id: existing.id }, data: parsed.data, select });
    await audit(request, "unavailability.update", {
      tenantId,
      targetId: row.id,
      details: { vehicleId: row.vehicleId, reason: row.reason, startAt: row.startAt, endAt: row.endAt },
    });
    return { unavailability: publicRow(row) };
  });

  app.delete("/unavailabilities/:id", { preHandler: [app.requireAuth, app.requireRole(...WRITERS)] }, async (request, reply) => {
    const tenantId = request.currentUser!.tenantId!;
    const existing = await findOwned(request.params, tenantId);
    if (!existing) return reply.notFound();
    await prisma.vehicleUnavailability.delete({ where: { id: existing.id } });
    await audit(request, "unavailability.delete", {
      tenantId,
      targetId: existing.id,
      details: { vehicleId: existing.vehicleId, reason: existing.reason, startAt: existing.startAt, endAt: existing.endAt },
    });
    return reply.code(204).send();
  });
};

export default unavailabilityRoutes;
