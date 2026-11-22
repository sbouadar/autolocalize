import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { type Cell, frenchDateTime, frenchDay, toCsv } from "../lib/csv.js";
import { assignmentsDuring, driverAt } from "../lib/drivers.js";
import { nextDay, zonedDayStart } from "../lib/expenses.js";
import { MAINTENANCE_LABELS, type MaintenanceTypeKey } from "../lib/maintenance.js";
import { reliableTrip } from "../lib/positions.js";
import { prisma } from "../lib/prisma.js";
import { firstIssue } from "../lib/tenant-branding.js";
import { isPlausibleTrip, knotsToKmh, traccar } from "../lib/traccar.js";
import { REPORT_RATE_LIMIT } from "./vehicles.js";

// Exports CSV (M9) : trajets, locations, dépenses, entretiens. Admin du client et comptes en
// consultation. Jamais de numéro de pièce d'identité ni de permis dans un export.

const TRIPS_MAX_DAYS = 31;
const OTHER_MAX_DAYS = 366;
const TRIP_REPORTS_CONCURRENCY = 3;
const ROWS_MAX = 20_000;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= "2000-01-01";
  }, "Date invalide");
const query = z.object({ from: day, to: day, vehicleId: z.string().regex(/^[a-z0-9]{1,64}$/).optional() });

const EXPENSE_LABELS: Record<string, string> = {
  FUEL: "Carburant",
  MAINTENANCE: "Entretien",
  REPAIR: "Réparation",
  INSURANCE: "Assurance",
  TAX: "Taxes",
  TOLL: "Péage",
  FINE: "Amende",
  PARKING: "Stationnement",
  CLEANING: "Lavage",
  OTHER: "Autre",
};
const RENTAL_STATUS: Record<string, string> = { RESERVED: "Réservée", ONGOING: "En cours", COMPLETED: "Terminée", CANCELLED: "Annulée" };

const round1 = (n: number) => Math.round(n * 10) / 10;
const money = (d: { toFixed: (n: number) => string } | null) => (d ? Number(d.toFixed(2)) : null);

/** Exécute les tâches avec au plus `limit` en cours à la fois, dans l'ordre. */
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

function sendCsv(reply: FastifyReply, fileName: string, header: string[], rows: Cell[][]) {
  return reply
    .header("Content-Type", "text/csv; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${fileName}"`)
    .header("Cache-Control", "private, no-store")
    .header("X-Content-Type-Options", "nosniff")
    .send(toCsv(header, rows));
}

const exportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);
  app.addHook("preHandler", app.requireRole("TENANT_ADMIN", "VIEWER"));

  /** Période et véhicule demandés, contrôlés ; null si la réponse d'erreur est déjà envoyée. */
  const prepare = async (request: FastifyRequest, reply: FastifyReply, maxDays: number) => {
    const parsed = query.safeParse(request.query);
    if (!parsed.success) {
      reply.badRequest(firstIssue(parsed.error));
      return null;
    }
    const { from, to, vehicleId } = parsed.data;
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (days < 0) {
      reply.badRequest("La fin doit être après le début");
      return null;
    }
    if (days >= maxDays) {
      reply.badRequest(`Période de ${maxDays} jours au plus`);
      return null;
    }
    const tenantId = request.currentUser!.tenantId!;
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true, currency: true, rentalsEnabled: true, driversEnabled: true } });
    // Véhicule d'un autre client : traité comme inexistant.
    if (vehicleId && !(await prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId }, select: { id: true } }))) {
      reply.notFound();
      return null;
    }
    return { tenantId, tenant, from, to, vehicleId, start: zonedDayStart(from, tenant.timezone), end: zonedDayStart(nextDay(to), tenant.timezone) };
  };

  const logExport = (request: FastifyRequest, tenantId: string, kind: string, p: { from: string; to: string; vehicleId?: string }, rows: number) =>
    audit(request, "export.download", { tenantId, details: { kind, from: p.from, to: p.to, vehicleId: p.vehicleId ?? null, rows } });

  app.get("/exports/trips.csv", { config: REPORT_RATE_LIMIT }, async (request, reply) => {
    const p = await prepare(request, reply, TRIPS_MAX_DAYS);
    if (!p) return reply;
    const vehicles = await prisma.vehicle.findMany({
      where: { tenantId: p.tenantId, ...(p.vehicleId && { id: p.vehicleId }) },
      select: { id: true, name: true, plate: true, traccarDeviceId: true },
      orderBy: { name: "asc" },
    });
    let reports;
    try {
      reports = await mapLimited(vehicles, TRIP_REPORTS_CONCURRENCY, (v) => traccar.getReport("trips", [v.traccarDeviceId], p.start, p.end));
    } catch (err) {
      request.log.error({ err }, "Échec du rapport de trajets Traccar (export)");
      return reply.serviceUnavailable("Historique momentanément indisponible");
    }
    const spans = p.tenant.driversEnabled ? await assignmentsDuring(vehicles.map((v) => v.id), p.start, p.end) : null;
    const rows: Cell[][] = [];
    for (const [i, v] of vehicles.entries()) {
      const trips = reports[i]!;
      const reliable = await Promise.all(trips.map((t) => reliableTrip(t, request.log)));
      for (const [j, t] of trips.entries()) {
        const fixed = reliable[j];
        const start = new Date(t.startTime);
        const distanceKm = fixed ? round1(fixed.distance / 1000) : null;
        const average = !fixed ? null : isPlausibleTrip(t) ? knotsToKmh(t.averageSpeed) : t.duration > 0 ? round1((fixed.distance / t.duration) * 3_600) : null;
        rows.push([
          v.name,
          v.plate,
          ...(spans ? [driverAt(spans, v.id, start)?.driverName ?? null] : []),
          frenchDateTime(start, p.tenant.timezone),
          frenchDateTime(new Date(t.endTime), p.tenant.timezone),
          Math.round(t.duration / 60_000),
          distanceKm,
          average,
          knotsToKmh(t.maxSpeed),
          fixed?.start.latitude ?? t.startLat,
          fixed?.start.longitude ?? t.startLon,
          fixed?.end.latitude ?? t.endLat,
          fixed?.end.longitude ?? t.endLon,
        ]);
      }
    }
    const header = [
      "Véhicule",
      "Plaque",
      ...(spans ? ["Conducteur"] : []),
      "Départ",
      "Arrivée",
      "Durée (min)",
      "Distance (km)",
      "Vitesse moyenne (km/h)",
      "Vitesse max (km/h)",
      "Latitude départ",
      "Longitude départ",
      "Latitude arrivée",
      "Longitude arrivée",
    ];
    await logExport(request, p.tenantId, "trips", p, rows.length);
    return sendCsv(reply, `trajets-${p.from}-${p.to}.csv`, header, rows.slice(0, ROWS_MAX));
  });

  app.get("/exports/rentals.csv", async (request, reply) => {
    const p = await prepare(request, reply, OTHER_MAX_DAYS);
    if (!p) return reply;
    if (!p.tenant.rentalsEnabled) return reply.notFound();
    const rentals = await prisma.rental.findMany({
      where: { tenantId: p.tenantId, startAt: { lt: p.end }, endAt: { gte: p.start }, ...(p.vehicleId && { vehicleId: p.vehicleId }) },
      select: {
        id: true,
        status: true,
        vehicleName: true,
        vehiclePlate: true,
        customer: { select: { name: true, phone: true, anonymizedAt: true } },
        driverName: true,
        startAt: true,
        endAt: true,
        pickedUpAt: true,
        returnedAt: true,
        pickupLocation: true,
        returnLocation: true,
        odometerOutKm: true,
        odometerInKm: true,
        gpsDistanceKm: true,
        price: true,
        deposit: true,
      },
      orderBy: { startAt: "asc" },
      take: ROWS_MAX,
    });
    const tz = p.tenant.timezone;
    const rows: Cell[][] = rentals.map((r) => [
      r.id.slice(-8).toUpperCase(),
      RENTAL_STATUS[r.status] ?? r.status,
      r.vehicleName,
      r.vehiclePlate,
      r.customer.anonymizedAt ? "Client anonymisé" : r.customer.name,
      r.customer.anonymizedAt ? null : r.customer.phone,
      r.driverName,
      frenchDateTime(r.startAt, tz),
      frenchDateTime(r.endAt, tz),
      frenchDateTime(r.pickedUpAt, tz),
      frenchDateTime(r.returnedAt, tz),
      r.pickupLocation,
      r.returnLocation,
      r.odometerOutKm,
      r.odometerInKm,
      r.odometerInKm != null && r.odometerOutKm != null ? r.odometerInKm - r.odometerOutKm : null,
      r.gpsDistanceKm != null ? round1(r.gpsDistanceKm) : null,
      money(r.price),
      money(r.deposit),
      p.tenant.currency,
    ]);
    const header = [
      "Référence",
      "Statut",
      "Véhicule",
      "Plaque",
      "Locataire",
      "Téléphone",
      "Conducteur",
      "Départ prévu",
      "Retour prévu",
      "Départ réel",
      "Retour réel",
      "Lieu de prise en charge",
      "Lieu de dépôt",
      "Compteur départ (km)",
      "Compteur retour (km)",
      "Distance compteur (km)",
      "Distance GPS (km)",
      "Prix",
      "Caution",
      "Devise",
    ];
    await logExport(request, p.tenantId, "rentals", p, rows.length);
    return sendCsv(reply, `locations-${p.from}-${p.to}.csv`, header, rows);
  });

  app.get("/exports/expenses.csv", async (request, reply) => {
    const p = await prepare(request, reply, OTHER_MAX_DAYS);
    if (!p) return reply;
    const expenses = await prisma.expense.findMany({
      where: {
        tenantId: p.tenantId,
        spentOn: { gte: new Date(`${p.from}T00:00:00Z`), lte: new Date(`${p.to}T00:00:00Z`) },
        ...(p.vehicleId && { vehicleId: p.vehicleId }),
      },
      select: { spentOn: true, category: true, amount: true, liters: true, km: true, notes: true, vehicle: { select: { name: true, plate: true } } },
      orderBy: [{ spentOn: "asc" }, { createdAt: "asc" }],
      take: ROWS_MAX,
    });
    const rows: Cell[][] = expenses.map((e) => [
      frenchDay(e.spentOn),
      e.vehicle.name,
      e.vehicle.plate,
      EXPENSE_LABELS[e.category] ?? e.category,
      money(e.amount),
      p.tenant.currency,
      e.liters,
      e.km,
      e.notes,
    ]);
    await logExport(request, p.tenantId, "expenses", p, rows.length);
    return sendCsv(reply, `depenses-${p.from}-${p.to}.csv`, ["Date", "Véhicule", "Plaque", "Catégorie", "Montant", "Devise", "Litres", "Compteur (km)", "Notes"], rows);
  });

  app.get("/exports/maintenance.csv", async (request, reply) => {
    const p = await prepare(request, reply, OTHER_MAX_DAYS);
    if (!p) return reply;
    const records = await prisma.maintenanceRecord.findMany({
      where: {
        tenantId: p.tenantId,
        doneOn: { gte: new Date(`${p.from}T00:00:00Z`), lte: new Date(`${p.to}T00:00:00Z`) },
        ...(p.vehicleId && { vehicleId: p.vehicleId }),
      },
      select: { doneOn: true, type: true, label: true, km: true, garage: true, notes: true, vehicle: { select: { name: true, plate: true } }, expenses: { select: { amount: true } } },
      orderBy: [{ doneOn: "asc" }, { createdAt: "asc" }],
      take: ROWS_MAX,
    });
    const rows: Cell[][] = records.map((r) => [
      frenchDay(r.doneOn),
      r.vehicle.name,
      r.vehicle.plate,
      r.type === "OTHER" && r.label ? r.label : MAINTENANCE_LABELS[r.type as MaintenanceTypeKey],
      r.km,
      r.garage,
      r.expenses.length ? r.expenses.reduce((cents, e) => cents + Math.round(Number(e.amount.toFixed(2)) * 100), 0) / 100 : null,
      r.expenses.length ? p.tenant.currency : null,
      r.notes,
    ]);
    await logExport(request, p.tenantId, "maintenance", p, rows.length);
    return sendCsv(reply, `entretiens-${p.from}-${p.to}.csv`, ["Date", "Véhicule", "Plaque", "Entretien", "Compteur (km)", "Garage", "Coût", "Devise", "Notes"], rows);
  });
};

export default exportRoutes;
