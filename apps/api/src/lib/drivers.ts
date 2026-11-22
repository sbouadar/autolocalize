import type { FastifyReply, FastifyRequest } from "fastify";
import type { TenantTaskContext } from "../jobs/scheduler.js";
import { daysBetween, isoDate } from "./deadlines.js";
import { recordAppEvent } from "./events.js";
import { prisma } from "./prisma.js";

// Module conducteurs (M8) : garde d'accès, attribution d'un instant au conducteur affecté, alertes
// d'expiration du permis.

export const DRIVER_READERS = ["TENANT_ADMIN", "AGENT", "VIEWER"] as const;
/** Délai d'avertissement avant l'expiration d'un permis. */
export const LICENSE_WARN_DAYS = 30;

/** preHandler (après requireAuth et requireRole) : module conducteurs activé, sinon 404. */
export async function requireDriversModule(request: FastifyRequest, reply: FastifyReply) {
  const tenantId = request.currentUser?.tenantId;
  const tenant = tenantId ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { driversEnabled: true } }) : null;
  if (!tenant?.driversEnabled) return reply.notFound();
}

export interface AssignmentSpan {
  vehicleId: string;
  driverId: string;
  driverName: string;
  startAt: Date;
  endAt: Date | null;
}

/** Affectations des véhicules donnés qui recoupent [from, to]. */
export async function assignmentsDuring(vehicleIds: string[], from: Date, to: Date): Promise<AssignmentSpan[]> {
  if (vehicleIds.length === 0) return [];
  const rows = await prisma.driverAssignment.findMany({
    where: { vehicleId: { in: vehicleIds }, startAt: { lte: to }, OR: [{ endAt: null }, { endAt: { gt: from } }] },
    select: { vehicleId: true, driverId: true, startAt: true, endAt: true, driver: { select: { name: true } } },
    orderBy: { startAt: "asc" },
  });
  return rows.map((r) => ({ vehicleId: r.vehicleId, driverId: r.driverId, driverName: r.driver.name, startAt: r.startAt, endAt: r.endAt }));
}

/** Conducteur affecté au véhicule à cet instant, ou null. */
export function driverAt(spans: AssignmentSpan[], vehicleId: string, at: Date): AssignmentSpan | null {
  return spans.find((s) => s.vehicleId === vehicleId && s.startAt <= at && (s.endAt === null || s.endAt > at)) ?? null;
}

/** Module conducteurs activé pour ce client ? */
export async function driversEnabled(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { driversEnabled: true } });
  return tenant?.driversEnabled === true;
}

const frenchDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Tâche quotidienne : permis qui expirent dans 30 jours, puis expirés (une alerte de chaque). */
export async function driverLicenseAlertsTask({ tenant, localDate, now }: TenantTaskContext): Promise<void> {
  const enabled = await prisma.tenant.findUnique({ where: { id: tenant.id }, select: { driversEnabled: true } });
  if (!enabled?.driversEnabled) return;
  const horizon = new Date(Date.parse(`${localDate}T00:00:00Z`) + LICENSE_WARN_DAYS * 86_400_000);
  const drivers = await prisma.driver.findMany({
    where: { tenantId: tenant.id, active: true, licenseExpiresOn: { lte: horizon } },
    select: { id: true, name: true, licenseExpiresOn: true, assignments: { where: { endAt: null }, select: { vehicleId: true }, take: 1 } },
  });
  for (const d of drivers) {
    const expires = isoDate(d.licenseExpiresOn!);
    const daysLeft = daysBetween(localDate, expires);
    const expired = daysLeft < 0;
    await recordAppEvent({
      tenantId: tenant.id,
      vehicleId: d.assignments[0]?.vehicleId ?? null,
      vehicleName: d.name,
      type: expired ? "DRIVER_LICENSE_EXPIRED" : "DRIVER_LICENSE_EXPIRING",
      eventTime: now,
      dedupKey: `driver:${d.id}:license:${expires}:${expired ? "expired" : "warn"}`,
      message: expired
        ? `Permis de ${d.name} : expiré depuis le ${frenchDate(expires)}`
        : daysLeft === 0
          ? `Permis de ${d.name} : expire aujourd'hui (${frenchDate(expires)})`
          : `Permis de ${d.name} : expire le ${frenchDate(expires)} (dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""})`,
    });
  }
}
