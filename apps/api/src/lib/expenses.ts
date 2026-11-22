import { localParts } from "../jobs/scheduler.js";
import { isoDate } from "./deadlines.js";

// Dépenses des véhicules (M7) et calculs de rentabilité. Montants manipulés en centimes entiers
// (au plus 99 999 999,99 par dépense : sans perte en virgule flottante), renvoyés en chaînes.

export const EXPENSE_CATEGORIES = ["FUEL", "MAINTENANCE", "REPAIR", "INSURANCE", "TAX", "TOLL", "FINE", "PARKING", "CLEANING", "OTHER"] as const;
export type ExpenseCategoryKey = (typeof EXPENSE_CATEGORIES)[number];

/** Rôles qui lisent les dépenses ; seuls l'admin et les agents en saisissent. */
export const EXPENSE_READERS = ["TENANT_ADMIN", "AGENT", "VIEWER"] as const;
export const EXPENSE_WRITERS = ["TENANT_ADMIN", "AGENT"] as const;
/** La rentabilité (recettes comprises) : admin et comptes en consultation, comme prévu au plan. */
export const PROFITABILITY_READERS = ["TENANT_ADMIN", "VIEWER"] as const;

export const expenseSelect = {
  id: true,
  vehicleId: true,
  vehicle: { select: { name: true, plate: true } },
  spentOn: true,
  category: true,
  amount: true,
  liters: true,
  km: true,
  maintenanceRecordId: true,
  notes: true,
  createdAt: true,
} as const;

type ExpenseRow = {
  vehicle: { name: string; plate: string | null };
  spentOn: Date;
  amount: { toFixed: (digits: number) => string };
} & Record<string, unknown>;

export function publicExpense<T extends ExpenseRow>(row: T) {
  const { vehicle, spentOn, amount, ...rest } = row;
  return { ...rest, vehicleName: vehicle.name, vehiclePlate: vehicle.plate, spentOn: isoDate(spentOn), amount: amount.toFixed(2) };
}

/** Montant décimal (Prisma) ou chaîne « 12.50 » → centimes. */
export function toCents(amount: { toString(): string } | string | number): number {
  return Math.round(Number(amount.toString()) * 100);
}

/** Centimes → « 1234.50 ». */
export function centsToString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Instant UTC du début d'une journée locale (AAAA-MM-JJ) dans un fuseau. Les fuseaux visés ont des
 * décalages en heures entières (Maroc, Europe) : la précision à l'heure suffit.
 */
export function zonedDayStart(day: string, timeZone: string): Date {
  const guess = Date.parse(`${day}T00:00:00Z`);
  const local = localParts(new Date(guess), timeZone);
  const offsetHours = local.date === day ? local.hour : local.date > day ? local.hour + 24 : local.hour - 24;
  return new Date(guess - offsetHours * 3_600_000);
}

/** Jour suivant d'une date AAAA-MM-JJ. */
export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
