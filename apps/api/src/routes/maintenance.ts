import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { centsToString, toCents } from "../lib/expenses.js";
import { isoDate } from "../lib/deadlines.js";
import { tenantScope } from "../lib/fleet.js";
import { currentKmByVehicle, MAINTENANCE_TYPES, planSelect, publicPlan } from "../lib/maintenance.js";
import { prisma } from "../lib/prisma.js";
import { firstIssue } from "../lib/tenant-branding.js";
import { expenseAmount } from "./expenses.js";
import { findOwnedVehicle, REPORT_RATE_LIMIT } from "./vehicles.js";

// Entretien (M4). Plans : lecture par tous, écriture par l'admin du client. Entretiens réalisés :
// saisis par l'admin et les agents.

const KM_MAX = 2_000_000;
const PLANS_PER_VEHICLE = 20;

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
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Date invalide")
  .refine((v) => v >= "2000-01-01", "Date trop ancienne")
  .refine((v) => Date.parse(`${v}T00:00:00Z`) <= Date.now() + 86_400_000, "La date ne peut pas être dans le futur")
  .transform((v) => new Date(`${v}T00:00:00Z`));

const planFields = {
  type: z.enum(MAINTENANCE_TYPES),
  label: optionalText(100),
  intervalKm: z.number().int().min(500).max(500_000).nullable(),
  intervalDays: z.number().int().min(7).max(3650).nullable(),
  lastDoneAt: dateOnly.nullable(),
  lastDoneKm: z.number().int().min(0).max(KM_MAX).nullable(),
  warnBeforeKm: z.number().int().min(0).max(50_000),
  warnBeforeDays: z.number().int().min(0).max(365),
  active: z.boolean(),
};

const createPlanBody = z.object(planFields).partial().required({ type: true }).strict();
const updatePlanBody = z.object(planFields).partial().strict();

const recordBody = z
  .object({
    planId: z.string().regex(/^[a-z0-9]{1,64}$/).nullable().optional(),
    type: z.enum(MAINTENANCE_TYPES).optional(),
    label: optionalText(100).optional(),
    doneOn: dateOnly,
    km: z.number().int().min(0).max(KM_MAX).nullable().optional(),
    garage: optionalText(191).optional(),
    notes: optionalText(2000).optional(),
    /** Coût de l'entretien : enregistré comme une dépense « entretien » liée (M7). */
    cost: expenseAmount.nullable().optional(),
  })
  .strict();

const idParam = z.object({ id: z.string().regex(/^[a-z0-9]{1,64}$/) });

/** Un plan doit avoir au moins un intervalle, et un nom s'il est de type « autre ». */
function planError(p: { type: string; label: string | null; intervalKm: number | null; intervalDays: number | null }): string | null {
  if (p.intervalKm == null && p.intervalDays == null) return "Indiquez un intervalle en kilomètres ou en jours";
  if (p.type === "OTHER" && !p.label) return "label : précisez le nom de l'entretien";
  return null;
}

const recordSelect = {
  id: true,
  planId: true,
  type: true,
  label: true,
  doneOn: true,
  km: true,
  garage: true,
  notes: true,
  createdAt: true,
  expenses: { select: { amount: true } },
} as const;
const publicRecord = <T extends { doneOn: Date; expenses: { amount: { toString(): string } }[] }>({ expenses, ...r }: T) => ({
  ...r,
  doneOn: isoDate(r.doneOn),
  /** Coût (dépenses liées), « 450.00 » ; null si aucun coût n'a été saisi. */
  cost: expenses.length ? centsToString(expenses.reduce((sum, e) => sum + toCents(e.amount), 0)) : null,
});

const maintenanceRoutes: FastifyPluginAsync = async (app) => {
  // Entretiens à prévoir ou en retard dans toute la flotte.
  app.get("/maintenance/due", { preHandler: app.requireAuth, config: REPORT_RATE_LIMIT }, async (request) => {
    const plans = await prisma.maintenancePlan.findMany({
      where: { ...tenantScope(request.currentUser!), active: true },
      select: planSelect,
      orderBy: [{ vehicleId: "asc" }, { createdAt: "asc" }],
      take: 500,
    });
    const km = await currentKmByVehicle(plans, request.log);
    const rank = { OVERDUE: 0, DUE: 1, OK: 2, UNKNOWN: 3 } as const;
    return {
      plans: plans
        .map((p) => publicPlan(p, km.get(p.vehicleId) ?? null))
        .filter((p) => p.status === "DUE" || p.status === "OVERDUE")
        .sort((a, b) => rank[a.status] - rank[b.status]),
    };
  });

  app.get("/vehicles/:id/maintenance-plans", { preHandler: app.requireAuth, config: REPORT_RATE_LIMIT }, async (request, reply) => {
    const vehicle = await findOwnedVehicle(request);
    if (!vehicle) return reply.notFound();
    const plans = await prisma.maintenancePlan.findMany({ where: { vehicleId: vehicle.id }, select: planSelect, orderBy: { createdAt: "asc" } });
    const km = await currentKmByVehicle(plans, request.log);
    return { plans: plans.map((p) => publicPlan(p, km.get(p.vehicleId) ?? null)) };
  });

  app.post(
    "/vehicles/:id/maintenance-plans",
    { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN")] },
    async (request, reply) => {
      const vehicle = await findOwnedVehicle(request);
      if (!vehicle) return reply.notFound();
      const parsed = createPlanBody.safeParse(request.body);
      if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
      const data = { label: null, intervalKm: null, intervalDays: null, ...parsed.data };
      const error = planError(data);
      if (error) return reply.badRequest(error);
      if ((await prisma.maintenancePlan.count({ where: { vehicleId: vehicle.id } })) >= PLANS_PER_VEHICLE) {
        return reply.conflict(`${PLANS_PER_VEHICLE} plans d'entretien au plus par véhicule`);
      }
      const row = await prisma.maintenancePlan.create({ data: { ...parsed.data, tenantId: vehicle.tenantId, vehicleId: vehicle.id }, select: planSelect });
      await audit(request, "maintenance.plan.create", { tenantId: vehicle.tenantId, targetId: row.id, details: { vehicleId: vehicle.id, type: row.type } });
      const km = await currentKmByVehicle([row], request.log);
      return reply.code(201).send({ plan: publicPlan(row, km.get(row.vehicleId) ?? null) });
    },
  );

  const findOwnedPlan = async (params: unknown, tenantId: string) => {
    const parsed = idParam.safeParse(params);
    return parsed.success ? prisma.maintenancePlan.findFirst({ where: { id: parsed.data.id, tenantId }, select: planSelect }) : null;
  };

  app.put("/maintenance-plans/:id", { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN")] }, async (request, reply) => {
    const tenantId = request.currentUser!.tenantId!;
    const existing = await findOwnedPlan(request.params, tenantId);
    if (!existing) return reply.notFound();
    const parsed = updatePlanBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const error = planError({ ...existing, ...parsed.data });
    if (error) return reply.badRequest(error);
    const row = await prisma.maintenancePlan.update({ where: { id: existing.id }, data: parsed.data, select: planSelect });
    await audit(request, "maintenance.plan.update", { tenantId, targetId: row.id, details: { fields: Object.keys(parsed.data).sort() } });
    const km = await currentKmByVehicle([row], request.log);
    return { plan: publicPlan(row, km.get(row.vehicleId) ?? null) };
  });

  app.delete("/maintenance-plans/:id", { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN")] }, async (request, reply) => {
    const tenantId = request.currentUser!.tenantId!;
    const existing = await findOwnedPlan(request.params, tenantId);
    if (!existing) return reply.notFound();
    // L'historique des entretiens réalisés est conservé (leur lien vers le plan est vidé).
    await prisma.maintenancePlan.delete({ where: { id: existing.id } });
    await audit(request, "maintenance.plan.delete", { tenantId, targetId: existing.id, details: { vehicleId: existing.vehicleId, type: existing.type } });
    return reply.code(204).send();
  });

  app.get("/vehicles/:id/maintenance-records", { preHandler: app.requireAuth }, async (request, reply) => {
    const vehicle = await findOwnedVehicle(request);
    if (!vehicle) return reply.notFound();
    const records = await prisma.maintenanceRecord.findMany({
      where: { vehicleId: vehicle.id },
      select: recordSelect,
      orderBy: [{ doneOn: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    return { records: records.map(publicRecord) };
  });

  // Entretien réalisé. Avec un plan : sa référence (date, kilométrage) avance, et ses alertes repartent.
  // Avec un kilométrage : un relevé de compteur est enregistré à la date de l'entretien.
  app.post(
    "/vehicles/:id/maintenance-records",
    { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN", "AGENT")] },
    async (request, reply) => {
      const vehicle = await findOwnedVehicle(request);
      if (!vehicle) return reply.notFound();
      const parsed = recordBody.safeParse(request.body);
      if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
      const { planId, doneOn, km = null, garage = null, notes = null, cost = null } = parsed.data;

      const plan = planId
        ? await prisma.maintenancePlan.findFirst({
            where: { id: planId, vehicleId: vehicle.id },
            select: { id: true, type: true, label: true, lastDoneAt: true, lastDoneKm: true },
          })
        : null;
      if (planId && !plan) return reply.badRequest("Plan d'entretien inconnu pour ce véhicule");
      const type = plan?.type ?? parsed.data.type;
      const label = plan ? plan.label : (parsed.data.label ?? null);
      if (!type) return reply.badRequest("type : précisez le type d'entretien");
      if (type === "OTHER" && !label) return reply.badRequest("label : précisez le nom de l'entretien");

      // Relevé de compteur à midi UTC du jour de l'entretien ; un compteur ne recule pas.
      const readAt = new Date(doneOn.getTime() + 12 * 3_600_000);
      if (km != null) {
        const [before, after] = await Promise.all([
          prisma.odometerReading.findFirst({ where: { vehicleId: vehicle.id, readAt: { lte: readAt }, km: { gt: km } }, select: { km: true } }),
          prisma.odometerReading.findFirst({ where: { vehicleId: vehicle.id, readAt: { gt: readAt }, km: { lt: km } }, select: { km: true } }),
        ]);
        if (before || after) {
          return reply.code(409).send({
            statusCode: 409,
            error: before
              ? `Le compteur ne peut pas reculer : un relevé antérieur indique déjà ${before.km} km`
              : `Le compteur ne peut pas reculer : un relevé plus récent indique ${after!.km} km`,
            code: "ODOMETER_DECREASE",
          });
        }
      }

      const record = await prisma.$transaction(async (tx) => {
        const created = await tx.maintenanceRecord.create({
          data: {
            tenantId: vehicle.tenantId,
            vehicleId: vehicle.id,
            planId: plan?.id ?? null,
            type,
            label,
            doneOn,
            km,
            garage,
            notes,
            createdBy: request.currentUser!.id,
            ...(cost != null && {
              expenses: {
                create: {
                  tenantId: vehicle.tenantId,
                  vehicleId: vehicle.id,
                  spentOn: doneOn,
                  category: "MAINTENANCE",
                  amount: cost.toFixed(2),
                  km,
                  notes: [label ?? null, garage].filter(Boolean).join(" · ").slice(0, 500) || null,
                  createdBy: request.currentUser!.id,
                },
              },
            }),
          },
          select: recordSelect,
        });
        // La référence du plan n'avance que si cet entretien est plus récent que le précédent.
        if (plan && (!plan.lastDoneAt || doneOn >= plan.lastDoneAt)) {
          await tx.maintenancePlan.update({ where: { id: plan.id }, data: { lastDoneAt: doneOn, ...(km != null && { lastDoneKm: km }) } });
        }
        if (km != null) {
          await tx.odometerReading.create({
            data: { tenantId: vehicle.tenantId, vehicleId: vehicle.id, km, readAt, source: "MAINTENANCE", createdBy: request.currentUser!.id },
          });
        }
        return created;
      });
      await audit(request, "maintenance.record.create", {
        tenantId: vehicle.tenantId,
        targetId: record.id,
        details: { vehicleId: vehicle.id, type, planId: plan?.id ?? null, doneOn: isoDate(doneOn), km, cost: cost?.toFixed(2) ?? null },
      });
      return reply.code(201).send({ record: publicRecord(record) });
    },
  );

  app.delete("/maintenance-records/:id", { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN")] }, async (request, reply) => {
    const parsed = idParam.safeParse(request.params);
    const tenantId = request.currentUser!.tenantId!;
    const record = parsed.success
      ? await prisma.maintenanceRecord.findFirst({ where: { id: parsed.data.id, tenantId }, select: { id: true, vehicleId: true, type: true, doneOn: true } })
      : null;
    if (!record) return reply.notFound();
    await prisma.maintenanceRecord.delete({ where: { id: record.id } });
    await audit(request, "maintenance.record.delete", { tenantId, targetId: record.id, details: { vehicleId: record.vehicleId, type: record.type, doneOn: isoDate(record.doneOn) } });
    return reply.code(204).send();
  });
};

export default maintenanceRoutes;
