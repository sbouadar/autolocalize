import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { localParts } from "../jobs/scheduler.js";
import { audit } from "../lib/audit.js";
import {
  centsToString,
  EXPENSE_CATEGORIES,
  EXPENSE_READERS,
  EXPENSE_WRITERS,
  expenseSelect,
  nextDay,
  PROFITABILITY_READERS,
  publicExpense,
  toCents,
  zonedDayStart,
} from "../lib/expenses.js";
import { gpsDistanceKm } from "../lib/odometer.js";
import { prisma } from "../lib/prisma.js";
import { firstIssue } from "../lib/tenant-branding.js";
import { REPORT_RATE_LIMIT } from "./vehicles.js";

// Dépenses des véhicules et rentabilité (M7). Le client vient de la session ; le super-admin n'y
// accède que par « Se connecter en tant que ».

const KM_MAX = 2_000_000;
const LIST_MAX = 500;
const PERIOD_MAX_DAYS = 366;
/** Rapports de trajets Traccar demandés en même temps pour les distances. */
const DISTANCE_CONCURRENCY = 3;

const id = z.string().regex(/^[a-z0-9]{1,64}$/);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Date invalide")
  .refine((v) => v >= "2000-01-01", "Date trop ancienne");
const pastDay = day.refine((v) => Date.parse(`${v}T00:00:00Z`) <= Date.now() + 86_400_000, "La date ne peut pas être dans le futur");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

/** Montant strictement positif, 2 décimales au plus. */
export const expenseAmount = z
  .number()
  .positive()
  .max(99_999_999)
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "2 décimales au plus");

const fields = {
  vehicleId: id,
  spentOn: pastDay,
  category: z.enum(EXPENSE_CATEGORIES),
  amount: expenseAmount,
  liters: z.number().positive().max(2000).nullable(),
  km: z.number().int().min(0).max(KM_MAX).nullable(),
  notes: optionalText(500),
};
const createBody = z.object(fields).partial().required({ vehicleId: true, spentOn: true, category: true, amount: true }).strict();
const updateBody = z.object(fields).partial().strict();

const listQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  vehicleId: id.optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
});
const periodQuery = z.object({ from: day, to: day });
const idParam = z.object({ id });

function periodError(from: string, to: string): string | null {
  if (to < from) return "La fin doit être après le début";
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 >= PERIOD_MAX_DAYS) {
    return `Période de ${PERIOD_MAX_DAYS} jours au plus`;
  }
  return null;
}

const asDate = (v: string) => new Date(`${v}T00:00:00Z`);

/** Exécute les tâches avec au plus `limit` en cours à la fois. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    }),
  );
  return results;
}

const expenseRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);
  const readers = app.requireRole(...EXPENSE_READERS);
  const writers = app.requireRole(...EXPENSE_WRITERS);
  const adminOnly = app.requireRole("TENANT_ADMIN");
  const tenantOf = (request: FastifyRequest) => request.currentUser!.tenantId!;

  const findOwned = async (request: FastifyRequest) => {
    const parsed = idParam.safeParse(request.params);
    return parsed.success ? prisma.expense.findFirst({ where: { id: parsed.data.id, tenantId: tenantOf(request) }, select: expenseSelect }) : null;
  };

  /** Le litrage n'a de sens que pour le carburant. */
  const litersError = (category: string, liters: number | null | undefined) =>
    liters != null && category !== "FUEL" ? "liters : le litrage ne concerne que le carburant" : null;

  // Dépenses du client, les plus récentes d'abord, avec leur total.
  app.get("/expenses", { preHandler: readers }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const { from, to, vehicleId, category } = parsed.data;
    const where = {
      tenantId: tenantOf(request),
      ...((from || to) && { spentOn: { ...(from && { gte: asDate(from) }), ...(to && { lte: asDate(to) }) } }),
      ...(vehicleId && { vehicleId }),
      ...(category && { category }),
    };
    const [rows, sum] = await Promise.all([
      prisma.expense.findMany({ where, select: expenseSelect, orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }], take: LIST_MAX }),
      prisma.expense.aggregate({ where, _sum: { amount: true }, _count: true }),
    ]);
    return {
      expenses: rows.map(publicExpense),
      total: (sum._sum.amount ?? 0).toFixed(2),
      count: sum._count,
      truncated: sum._count > rows.length,
    };
  });

  app.post("/expenses", { preHandler: writers }, async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = tenantOf(request);
    const { vehicleId, spentOn, ...rest } = parsed.data;
    const error = litersError(rest.category, rest.liters);
    if (error) return reply.badRequest(error);
    // Véhicule d'un autre client : traité comme inexistant.
    const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId }, select: { id: true } });
    if (!vehicle) return reply.badRequest("Véhicule inconnu");
    const row = await prisma.expense.create({
      data: { ...rest, amount: rest.amount.toFixed(2), tenantId, vehicleId, spentOn: asDate(spentOn), createdBy: request.currentUser!.id },
      select: expenseSelect,
    });
    await audit(request, "expense.create", { tenantId, targetId: row.id, details: { vehicleId, category: row.category, amount: row.amount.toFixed(2), spentOn } });
    return reply.code(201).send({ expense: publicExpense(row) });
  });

  app.put("/expenses/:id", { preHandler: adminOnly }, async (request, reply) => {
    const existing = await findOwned(request);
    if (!existing) return reply.notFound();
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = tenantOf(request);
    const data = parsed.data;
    const category = data.category ?? existing.category;
    const liters = data.liters !== undefined ? data.liters : category === "FUEL" ? existing.liters : null;
    const error = litersError(category, liters);
    if (error) return reply.badRequest(error);
    if (data.vehicleId && !(await prisma.vehicle.findFirst({ where: { id: data.vehicleId, tenantId }, select: { id: true } }))) {
      return reply.badRequest("Véhicule inconnu");
    }
    const row = await prisma.expense.update({
      where: { id: existing.id },
      data: {
        ...data,
        ...(data.amount !== undefined && { amount: data.amount.toFixed(2) }),
        ...(data.spentOn !== undefined && { spentOn: asDate(data.spentOn) }),
        // Passée dans une autre catégorie que le carburant : le litrage est effacé.
        ...(category !== "FUEL" && { liters: null }),
      },
      select: expenseSelect,
    });
    await audit(request, "expense.update", { tenantId, targetId: row.id, details: { fields: Object.keys(data).sort() } });
    return { expense: publicExpense(row) };
  });

  app.delete("/expenses/:id", { preHandler: adminOnly }, async (request, reply) => {
    const existing = await findOwned(request);
    if (!existing) return reply.notFound();
    await prisma.expense.delete({ where: { id: existing.id } });
    const tenantId = tenantOf(request);
    await audit(request, "expense.delete", {
      tenantId,
      targetId: existing.id,
      details: { vehicleId: existing.vehicleId, category: existing.category, amount: existing.amount.toFixed(2), spentOn: existing.spentOn.toISOString().slice(0, 10) },
    });
    return reply.code(204).send();
  });

  // Rentabilité par véhicule sur une période (jours inclus, dans le fuseau du client) : recettes des
  // locations terminées dans la période, dépenses, distance GPS, coût au kilomètre, consommation.
  app.get("/reports/profitability", { preHandler: app.requireRole(...PROFITABILITY_READERS), config: REPORT_RATE_LIMIT }, async (request, reply) => {
    const parsed = periodQuery.safeParse(request.query);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const { from, to } = parsed.data;
    const error = periodError(from, to);
    if (error) return reply.badRequest(error);
    const tenantId = tenantOf(request);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { currency: true, timezone: true, rentalsEnabled: true } });
    const start = zonedDayStart(from, tenant.timezone);
    const end = zonedDayStart(nextDay(to), tenant.timezone);

    const [vehicles, expenses, rentals] = await Promise.all([
      prisma.vehicle.findMany({ where: { tenantId }, select: { id: true, name: true, plate: true, traccarDeviceId: true }, orderBy: { name: "asc" } }),
      prisma.expense.findMany({
        where: { tenantId, spentOn: { gte: asDate(from), lte: asDate(to) } },
        select: { vehicleId: true, category: true, amount: true, liters: true },
      }),
      // Recettes : locations terminées dont le retour tombe dans la période.
      prisma.rental.findMany({
        where: { tenantId, status: "COMPLETED", returnedAt: { gte: start, lt: end } },
        select: { vehicleId: true, price: true, returnedAt: true },
      }),
    ]);

    const distances = await mapLimited(vehicles, DISTANCE_CONCURRENCY, (v) => gpsDistanceKm(v.traccarDeviceId, start, end, request.log));
    const categoryTotals = new Map<string, number>();
    const rows = vehicles.map((v, i) => {
      const own = expenses.filter((e) => e.vehicleId === v.id);
      const ownRentals = rentals.filter((r) => r.vehicleId === v.id && r.returnedAt && localParts(r.returnedAt, tenant.timezone).date <= to);
      const expenseCents = own.reduce((sum, e) => sum + toCents(e.amount), 0);
      const revenueCents = ownRentals.reduce((sum, r) => sum + (r.price ? toCents(r.price) : 0), 0);
      const byCategory = new Map<string, number>();
      for (const e of own) {
        byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + toCents(e.amount));
        categoryTotals.set(e.category, (categoryTotals.get(e.category) ?? 0) + toCents(e.amount));
      }
      const fuelLiters = own.reduce((sum, e) => sum + (e.category === "FUEL" ? (e.liters ?? 0) : 0), 0);
      const distanceKm = distances[i] ?? null;
      return {
        vehicleId: v.id,
        name: v.name,
        plate: v.plate,
        rentalCount: ownRentals.length,
        revenueCents,
        expenseCents,
        distanceKm,
        fuelLiters,
        byCategory: [...byCategory].map(([category, cents]) => ({ category, amount: centsToString(cents) })),
      };
    });

    const costPerKm = (cents: number, km: number | null) => (km != null && km > 0 && cents > 0 ? centsToString(Math.round(cents / km)) : null);
    const consumption = (liters: number, km: number | null) => (liters > 0 && km != null && km >= 50 ? Math.round((liters / km) * 1000) / 10 : null);
    const knownDistances = rows.map((r) => r.distanceKm).filter((d): d is number => d != null);
    const totalDistance = knownDistances.length === rows.length && rows.length > 0 ? Math.round(knownDistances.reduce((a, b) => a + b, 0) * 10) / 10 : null;
    const totals = rows.reduce((t, r) => ({ revenue: t.revenue + r.revenueCents, expenses: t.expenses + r.expenseCents, liters: t.liters + r.fuelLiters }), {
      revenue: 0,
      expenses: 0,
      liters: 0,
    });

    return {
      from,
      to,
      currency: tenant.currency,
      rentalsEnabled: tenant.rentalsEnabled,
      /** Distances absentes : Traccar indisponible. */
      distanceAvailable: knownDistances.length === rows.length,
      totals: {
        revenue: centsToString(totals.revenue),
        expenses: centsToString(totals.expenses),
        margin: centsToString(totals.revenue - totals.expenses),
        distanceKm: totalDistance,
        costPerKm: costPerKm(totals.expenses, totalDistance),
        fuelLiters: Math.round(totals.liters * 10) / 10,
      },
      byCategory: [...categoryTotals].sort((a, b) => b[1] - a[1]).map(([category, cents]) => ({ category, amount: centsToString(cents) })),
      vehicles: rows
        .map((r) => ({
          vehicleId: r.vehicleId,
          name: r.name,
          plate: r.plate,
          rentalCount: r.rentalCount,
          revenue: centsToString(r.revenueCents),
          expenses: centsToString(r.expenseCents),
          margin: centsToString(r.revenueCents - r.expenseCents),
          distanceKm: r.distanceKm,
          costPerKm: costPerKm(r.expenseCents, r.distanceKm),
          fuelLiters: Math.round(r.fuelLiters * 10) / 10,
          consumptionL100: consumption(r.fuelLiters, r.distanceKm),
          byCategory: r.byCategory,
          marginCents: r.revenueCents - r.expenseCents,
        }))
        // Les moins rentables en bas : marge décroissante, puis par nom.
        .sort((a, b) => b.marginCents - a.marginCents || a.name.localeCompare(b.name))
        .map(({ marginCents: _m, ...rest }) => rest),
    };
  });
};

export default expenseRoutes;
