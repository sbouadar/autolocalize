// Dates sans heure saisies au clavier (pas de sélecteur de date natif pour l'instant).

/** « 31/12/2026 » (ou 31-12-2026, 31.12.2026, 31/12/26) → « 2026-12-31 » ; null si la date n'existe pas. */
export function parseFrenchDate(input: string): string | null {
  const m = /^\s*(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})\s*$/.exec(input);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** « 2026-12-31 » → « 31/12/2026 ». */
export function formatDateOnly(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Date locale du jour au format de saisie (« 22/11/2026 »). */
export function todayFrench(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()}`;
}

/** Début (ou fin) de la journée locale d'une date AAAA-MM-JJ, en instant ISO. */
export function localDayBoundary(iso: string, edge: "start" | "end"): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d + (edge === "end" ? 1 : 0)).toISOString();
}

/** « 9:30 », « 09h30 », « 0930 » → { hours: 9, minutes: 30 } ; null si l'heure n'existe pas. */
export function parseTime(input: string): { hours: number; minutes: number } | null {
  const m = /^\s*(\d{1,2})\s*[:hH.]?\s*(\d{2})?\s*$/.exec(input);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  return hours <= 23 && minutes <= 59 ? { hours, minutes } : null;
}

/** Instant ISO d'une date (JJ/MM/AAAA) et d'une heure (HH:MM) saisies, en heure locale ; null si invalide. */
export function parseLocalDateTime(date: string, time: string): string | null {
  const day = parseFrenchDate(date);
  const t = parseTime(time);
  if (!day || !t) return null;
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, t.hours, t.minutes).toISOString();
}

// ─── Sélecteur de date (components/DateField) et liste d'heures ──────────────

export const MONTH_NAMES = [
  "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre",
] as const;

/** (2026, 10, 5) → « 2026-11-05 » (mois de 0 à 11). */
export function isoDay(year: number, month: number, day: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month + 1)}-${p(day)}`;
}

/** Date locale du jour, « 2026-11-22 ». */
export function todayIso(now = new Date()): string {
  return isoDay(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Semaines d'un mois (mois de 0 à 11), du lundi au dimanche ; null hors du mois. */
export function monthGrid(year: number, month: number): (number | null)[][] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Heures proposées dans les listes : toutes les demi-heures, de « 00:00 » à « 23:30 ». */
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const time = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
  return { key: time, label: time };
});

/** Instant ISO d'un jour (AAAA-MM-JJ) et d'une heure (HH:MM), en heure locale. */
export function localDateTime(day: string, time: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return new Date(y, m - 1, d, hours, minutes).toISOString();
}
