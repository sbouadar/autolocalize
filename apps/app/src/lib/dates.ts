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
