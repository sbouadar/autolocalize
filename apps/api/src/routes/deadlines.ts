import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { daysBetween, DEADLINE_TYPES, deadlineStatus, isoDate, todayIn } from "../lib/deadlines.js";
import { tenantScope } from "../lib/fleet.js";
import { prisma } from "../lib/prisma.js";
import { firstIssue } from "../lib/tenant-branding.js";
import { findOwnedVehicle } from "./vehicles.js";

// Échéances administratives des véhicules (M3) : lecture par tous, écriture par l'admin du client.

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

/** Date sans heure, AAAA-MM-JJ, réelle (pas de 31 février) et dans une plage raisonnable. */
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Date invalide")
  .refine((v) => v >= "2000-01-01" && v <= "2100-12-31", "Date hors limites")
  .transform((v) => new Date(`${v}T00:00:00Z`));

const fields = {
  type: z.enum(DEADLINE_TYPES),
  label: optionalText(100),
  expiresOn: dateOnly,
  reference: optionalText(100),
  warnDaysBefore: z.number().int().min(0).max(365),
  notes: optionalText(500),
};

const createBody = z
  .object({ ...fields, label: fields.label.optional(), reference: fields.reference.optional(), warnDaysBefore: fields.warnDaysBefore.optional(), notes: fields.notes.optional() })
  .strict()
  .refine((b) => b.type !== "OTHER" || Boolean(b.label), { message: "label : précisez le nom de l'échéance", path: ["label"] });

const updateBody = z.object(fields).partial().strict();

const listQuery = z.object({ dueWithinDays: z.coerce.number().int().min(0).max(366).optional() });
const idParam = z.object({ id: z.string().regex(/^[a-z0-9]{1,64}$/) });

const select = {
  id: true,
  vehicleId: true,
  type: true,
  label: true,
  expiresOn: true,
  reference: true,
  warnDaysBefore: true,
  notes: true,
  vehicle: { select: { name: true, plate: true } },
  tenant: { select: { timezone: true } },
} as const;

type Row = {
  id: string;
  vehicleId: string;
  type: string;
  label: string | null;
  expiresOn: Date;
  reference: string | null;
  warnDaysBefore: number;
  notes: string | null;
  vehicle: { name: string; plate: string | null };
  tenant: { timezone: string };
};

function publicDeadline(row: Row, now = new Date()) {
  const expiresOn = isoDate(row.expiresOn);
  const daysLeft = daysBetween(todayIn(row.tenant.timezone, now), expiresOn);
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    vehicleName: row.vehicle.name,
    vehiclePlate: row.vehicle.plate,
    type: row.type,
    label: row.label,
    expiresOn,
    reference: row.reference,
    warnDaysBefore: row.warnDaysBefore,
    notes: row.notes,
    daysLeft,
    status: deadlineStatus(daysLeft, row.warnDaysBefore),
  };
}

const deadlineRoutes: FastifyPluginAsync = async (app) => {
  // Échéances de toute la flotte, les plus proches d'abord ; dueWithinDays limite à celles qui
  // expirent dans ce délai (les échéances déjà dépassées sont toujours incluses).
  app.get("/deadlines", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Paramètres invalides");
    const rows = await prisma.vehicleDeadline.findMany({
      where: tenantScope(request.currentUser!),
      select,
      orderBy: [{ expiresOn: "asc" }, { id: "asc" }],
      take: 500,
    });
    const within = parsed.data.dueWithinDays;
    const deadlines = rows.map((r) => publicDeadline(r)).filter((d) => within === undefined || d.daysLeft <= within);
    return { deadlines };
  });

  app.get("/vehicles/:id/deadlines", { preHandler: app.requireAuth }, async (request, reply) => {
    const vehicle = await findOwnedVehicle(request);
    if (!vehicle) return reply.notFound();
    const rows = await prisma.vehicleDeadline.findMany({
      where: { vehicleId: vehicle.id },
      select,
      orderBy: [{ expiresOn: "asc" }, { id: "asc" }],
    });
    return { deadlines: rows.map((r) => publicDeadline(r)) };
  });

  app.post(
    "/vehicles/:id/deadlines",
    { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN")] },
    async (request, reply) => {
      const vehicle = await findOwnedVehicle(request);
      if (!vehicle) return reply.notFound();
      const parsed = createBody.safeParse(request.body);
      if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
      if ((await prisma.vehicleDeadline.count({ where: { vehicleId: vehicle.id } })) >= 30) {
        return reply.conflict("30 échéances au plus par véhicule");
      }
      const row = await prisma.vehicleDeadline.create({
        data: { ...parsed.data, tenantId: vehicle.tenantId, vehicleId: vehicle.id },
        select,
      });
      await audit(request, "deadline.create", {
        tenantId: vehicle.tenantId,
        targetId: row.id,
        details: { vehicleId: vehicle.id, type: row.type, expiresOn: isoDate(row.expiresOn) },
      });
      return reply.code(201).send({ deadline: publicDeadline(row) });
    },
  );

  /** Échéance du client connecté ; celle d'un autre client est traitée comme inexistante. */
  const findOwned = async (params: unknown, tenantId: string) => {
    const parsed = idParam.safeParse(params);
    return parsed.success ? prisma.vehicleDeadline.findFirst({ where: { id: parsed.data.id, tenantId }, select }) : null;
  };

  app.put("/deadlines/:id", { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN")] }, async (request, reply) => {
    const tenantId = request.currentUser!.tenantId!;
    const existing = await findOwned(request.params, tenantId);
    if (!existing) return reply.notFound();
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const type = parsed.data.type ?? existing.type;
    const label = parsed.data.label !== undefined ? parsed.data.label : existing.label;
    if (type === "OTHER" && !label) return reply.badRequest("label : précisez le nom de l'échéance");

    const row = await prisma.vehicleDeadline.update({ where: { id: existing.id }, data: parsed.data, select });
    await audit(request, "deadline.update", {
      tenantId,
      targetId: row.id,
      details: { vehicleId: row.vehicleId, type: row.type, expiresOn: isoDate(row.expiresOn) },
    });
    return { deadline: publicDeadline(row) };
  });

  app.delete("/deadlines/:id", { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN")] }, async (request, reply) => {
    const tenantId = request.currentUser!.tenantId!;
    const existing = await findOwned(request.params, tenantId);
    if (!existing) return reply.notFound();
    await prisma.vehicleDeadline.delete({ where: { id: existing.id } });
    await audit(request, "deadline.delete", {
      tenantId,
      targetId: existing.id,
      details: { vehicleId: existing.vehicleId, type: existing.type, expiresOn: isoDate(existing.expiresOn) },
    });
    return reply.code(204).send();
  });
};

export default deadlineRoutes;
