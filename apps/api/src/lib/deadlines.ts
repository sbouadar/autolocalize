import type { TenantTaskContext } from "../jobs/scheduler.js";
import { localParts } from "../jobs/scheduler.js";
import { recordAppEvent } from "./events.js";
import { prisma } from "./prisma.js";

// Échéances administratives d'un véhicule (assurance, visite technique, vignette…) : état calculé
// dans le fuseau du client, et alertes quotidiennes (une avant l'expiration, une après).

export const DEADLINE_TYPES = ["INSURANCE", "TECHNICAL_INSPECTION", "ROAD_TAX", "REGISTRATION", "OTHER"] as const;
export type DeadlineTypeKey = (typeof DEADLINE_TYPES)[number];

export const DEADLINE_LABELS: Record<DeadlineTypeKey, string> = {
  INSURANCE: "Assurance",
  TECHNICAL_INSPECTION: "Visite technique",
  ROAD_TAX: "Vignette",
  REGISTRATION: "Carte grise",
  OTHER: "Échéance",
};

export type DeadlineStatus = "OK" | "WARNING" | "EXPIRED";

/** « 2026-12-31 » d'une date sans heure (stockée à minuit UTC). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Jours entre deux dates AAAA-MM-JJ (positif si `to` est après `from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function deadlineStatus(daysLeft: number, warnDaysBefore: number): DeadlineStatus {
  if (daysLeft < 0) return "EXPIRED";
  return daysLeft <= warnDaysBefore ? "WARNING" : "OK";
}

/** Date du jour dans le fuseau d'un client (repli sur Casablanca si le fuseau est invalide). */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    return localParts(now, timezone).date;
  } catch {
    return localParts(now, "Africa/Casablanca").date;
  }
}

const frenchDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function deadlineName(d: { type: string; label: string | null }): string {
  return d.type === "OTHER" && d.label ? d.label : (DEADLINE_LABELS[d.type as DeadlineTypeKey] ?? "Échéance");
}

/**
 * Tâche quotidienne : une alerte quand une échéance entre dans son délai d'avertissement, une autre
 * quand elle est dépassée. La date d'expiration fait partie de la clé : renouveler l'échéance fait
 * repartir les alertes.
 */
export async function deadlineAlertsTask({ tenant, localDate, now }: TenantTaskContext): Promise<void> {
  const horizon = new Date(Date.parse(`${localDate}T00:00:00Z`) + 366 * 86_400_000);
  const deadlines = await prisma.vehicleDeadline.findMany({
    where: { tenantId: tenant.id, expiresOn: { lte: horizon } },
    select: { id: true, type: true, label: true, expiresOn: true, warnDaysBefore: true, vehicleId: true, vehicle: { select: { name: true } } },
  });
  for (const d of deadlines) {
    const expires = isoDate(d.expiresOn);
    const daysLeft = daysBetween(localDate, expires);
    const status = deadlineStatus(daysLeft, d.warnDaysBefore);
    if (status === "OK") continue;
    const name = deadlineName(d);
    await recordAppEvent({
      tenantId: tenant.id,
      vehicleId: d.vehicleId,
      vehicleName: d.vehicle.name,
      type: status === "EXPIRED" ? "DOCUMENT_EXPIRED" : "DOCUMENT_EXPIRING",
      eventTime: now,
      dedupKey: `deadline:${d.id}:${expires}:${status === "EXPIRED" ? "expired" : "warn"}`,
      message:
        status === "EXPIRED"
          ? `${name} : expirée depuis le ${frenchDate(expires)}`
          : daysLeft === 0
            ? `${name} : expire aujourd'hui (${frenchDate(expires)})`
            : `${name} : expire le ${frenchDate(expires)} (dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""})`,
    });
  }
}
