import type { FastifyBaseLogger } from "fastify";
import type { TenantTaskContext } from "../jobs/scheduler.js";
import { daysBetween, isoDate, todayIn } from "./deadlines.js";
import { recordAppEvent } from "./events.js";
import { estimateOdometer } from "./odometer.js";
import { prisma } from "./prisma.js";

// Entretien périodique (M4) : prochaine échéance d'un plan = dernier entretien + intervalle, au
// kilométrage et/ou à la date, la plus proche des deux. Le kilométrage courant est le compteur
// estimé du véhicule (dernier relevé + distance GPS).

export const MAINTENANCE_TYPES = ["OIL_CHANGE", "TIRES", "BRAKES", "TIMING_BELT", "SERVICE", "BATTERY", "AIR_CONDITIONING", "OTHER"] as const;
export type MaintenanceTypeKey = (typeof MAINTENANCE_TYPES)[number];

export const MAINTENANCE_LABELS: Record<MaintenanceTypeKey, string> = {
  OIL_CHANGE: "Vidange",
  TIRES: "Pneus",
  BRAKES: "Freins",
  TIMING_BELT: "Courroie de distribution",
  SERVICE: "Révision",
  BATTERY: "Batterie",
  AIR_CONDITIONING: "Climatisation",
  OTHER: "Entretien",
};

export function maintenanceName(p: { type: string; label: string | null }): string {
  return p.type === "OTHER" && p.label ? p.label : (MAINTENANCE_LABELS[p.type as MaintenanceTypeKey] ?? "Entretien");
}

/** OK, à prévoir (dans le délai d'avertissement), en retard, ou inconnu (pas de référence pour calculer). */
export type MaintenanceStatus = "OK" | "DUE" | "OVERDUE" | "UNKNOWN";

export interface PlanInput {
  intervalKm: number | null;
  intervalDays: number | null;
  lastDoneAt: Date | null;
  lastDoneKm: number | null;
  warnBeforeKm: number;
  warnBeforeDays: number;
  createdAt: Date;
}

export interface PlanDue {
  status: MaintenanceStatus;
  /** Kilométrage auquel l'entretien est dû ; null sans intervalle kilométrique ou sans référence. */
  nextKm: number | null;
  /** Kilomètres restants (négatif : dépassé) ; null si le compteur du véhicule est inconnu. */
  kmLeft: number | null;
  /** Date à laquelle l'entretien est dû (AAAA-MM-JJ) ; null sans intervalle en jours. */
  nextDate: string | null;
  daysLeft: number | null;
}

const worst = (a: MaintenanceStatus, b: MaintenanceStatus): MaintenanceStatus => {
  const rank: Record<MaintenanceStatus, number> = { UNKNOWN: 0, OK: 1, DUE: 2, OVERDUE: 3 };
  return rank[a] >= rank[b] ? a : b;
};

/** Échéance d'un plan, d'après le compteur estimé du véhicule (null s'il est inconnu) et la date du jour. */
export function planDue(plan: PlanInput, currentKm: number | null, today: string): PlanDue {
  let status: MaintenanceStatus = "UNKNOWN";
  let nextKm: number | null = null;
  let kmLeft: number | null = null;
  let nextDate: string | null = null;
  let daysLeft: number | null = null;

  if (plan.intervalKm != null && plan.lastDoneKm != null) {
    nextKm = plan.lastDoneKm + plan.intervalKm;
    if (currentKm != null) {
      kmLeft = nextKm - currentKm;
      status = worst(status, kmLeft < 0 ? "OVERDUE" : kmLeft <= plan.warnBeforeKm ? "DUE" : "OK");
    }
  }
  if (plan.intervalDays != null) {
    // Sans entretien enregistré, l'intervalle court depuis la création du plan.
    const from = isoDate(plan.lastDoneAt ?? plan.createdAt);
    nextDate = new Date(Date.parse(`${from}T00:00:00Z`) + plan.intervalDays * 86_400_000).toISOString().slice(0, 10);
    daysLeft = daysBetween(today, nextDate);
    status = worst(status, daysLeft < 0 ? "OVERDUE" : daysLeft <= plan.warnBeforeDays ? "DUE" : "OK");
  }
  return { status, nextKm, kmLeft, nextDate, daysLeft };
}

export const planSelect = {
  id: true,
  vehicleId: true,
  type: true,
  label: true,
  intervalKm: true,
  intervalDays: true,
  lastDoneAt: true,
  lastDoneKm: true,
  warnBeforeKm: true,
  warnBeforeDays: true,
  active: true,
  createdAt: true,
  vehicle: { select: { name: true, plate: true, traccarDeviceId: true } },
  tenant: { select: { timezone: true } },
} as const;

type PlanRow = Awaited<ReturnType<typeof prisma.maintenancePlan.findFirstOrThrow<{ select: typeof planSelect }>>>;

/** Compteur estimé par véhicule (une estimation par véhicule, même avec plusieurs plans). */
export async function currentKmByVehicle(plans: PlanRow[], log: FastifyBaseLogger): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  for (const p of plans) {
    // Inutile d'interroger Traccar pour un plan sans intervalle kilométrique.
    if (p.intervalKm == null || result.has(p.vehicleId)) continue;
    const { lastReading, estimate } = await estimateOdometer({ id: p.vehicleId, traccarDeviceId: p.vehicle.traccarDeviceId }, log);
    // Traccar indisponible : on se rabat sur le dernier relevé (sous-estime le kilométrage).
    result.set(p.vehicleId, estimate.estimatedKm ?? lastReading?.km ?? null);
  }
  return result;
}

export function publicPlan(row: PlanRow, currentKm: number | null, now = new Date()) {
  const due = planDue(row, currentKm, todayIn(row.tenant.timezone, now));
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    vehicleName: row.vehicle.name,
    vehiclePlate: row.vehicle.plate,
    type: row.type,
    label: row.label,
    intervalKm: row.intervalKm,
    intervalDays: row.intervalDays,
    lastDoneAt: row.lastDoneAt ? isoDate(row.lastDoneAt) : null,
    lastDoneKm: row.lastDoneKm,
    warnBeforeKm: row.warnBeforeKm,
    warnBeforeDays: row.warnBeforeDays,
    active: row.active,
    currentKm,
    ...due,
  };
}

const frenchDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const kmText = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n).replace(/[\u202f\u00a0]/g, " ")} km`;

/**
 * Tâche quotidienne : une alerte quand un entretien entre dans son délai d'avertissement, une autre
 * quand il est dépassé. Le dernier entretien fait partie de la clé : un entretien enregistré fait
 * repartir les alertes pour le cycle suivant.
 */
export async function maintenanceAlertsTask({ tenant, localDate, now, log }: TenantTaskContext): Promise<void> {
  const plans = await prisma.maintenancePlan.findMany({ where: { tenantId: tenant.id, active: true }, select: planSelect });
  if (plans.length === 0) return;
  const km = await currentKmByVehicle(plans, log);
  for (const p of plans) {
    const due = planDue(p, km.get(p.vehicleId) ?? null, localDate);
    if (due.status !== "DUE" && due.status !== "OVERDUE") continue;
    const name = maintenanceName(p);
    const reasons = [
      due.kmLeft != null && due.nextKm != null && due.kmLeft <= p.warnBeforeKm
        ? due.kmLeft < 0
          ? `dépassé de ${kmText(-due.kmLeft)}`
          : `dans ${kmText(due.kmLeft)}`
        : null,
      due.daysLeft != null && due.nextDate != null && due.daysLeft <= p.warnBeforeDays
        ? due.daysLeft < 0
          ? `prévu le ${frenchDate(due.nextDate)}`
          : `le ${frenchDate(due.nextDate)}`
        : null,
    ].filter(Boolean);
    const cycle = `${p.lastDoneAt ? isoDate(p.lastDoneAt) : "none"}:${p.lastDoneKm ?? "none"}`;
    await recordAppEvent({
      tenantId: tenant.id,
      vehicleId: p.vehicleId,
      vehicleName: p.vehicle.name,
      type: due.status === "OVERDUE" ? "MAINTENANCE_OVERDUE" : "MAINTENANCE_DUE",
      eventTime: now,
      dedupKey: `maintenance:${p.id}:${cycle}:${due.status === "OVERDUE" ? "overdue" : "due"}`,
      message: `${name} ${due.status === "OVERDUE" ? "en retard" : "à prévoir"}${reasons.length ? ` : ${reasons.join(", ")}` : ""}`,
    });
  }
}
