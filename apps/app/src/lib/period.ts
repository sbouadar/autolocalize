// Périodes proposées pour l'historique, calculées dans le fuseau du téléphone.

export type PeriodKey = "today" | "yesterday" | "week" | "month";

/** Fiche véhicule : le tracé est limité à 7 jours par l'API. */
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Aujourd’hui" },
  { key: "yesterday", label: "Hier" },
  { key: "week", label: "7 jours" },
];

/** Tableau de bord : jusqu'à 30 jours (limite de l'API : 31). */
export const DASHBOARD_PERIODS: { key: PeriodKey; label: string }[] = [...PERIODS, { key: "month", label: "30 jours" }];

export interface PeriodRange {
  from: string;
  to: string;
}

function startOfDay(date: Date, daysAgo = 0): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

/** Bornes ISO de la période (« 7 jours » couvre aujourd'hui et les 6 jours précédents). */
export function periodRange(key: PeriodKey, now = new Date()): PeriodRange {
  switch (key) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: now.toISOString() };
    case "yesterday":
      return { from: startOfDay(now, 1).toISOString(), to: startOfDay(now).toISOString() };
    case "week":
      return { from: startOfDay(now, 6).toISOString(), to: now.toISOString() };
    case "month":
      return { from: startOfDay(now, 29).toISOString(), to: now.toISOString() };
  }
}

export function periodQuery(range: PeriodRange): string {
  return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
}
