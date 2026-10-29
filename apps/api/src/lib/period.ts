import { z } from "zod";

const DAY_MS = 86_400_000;
/** Marge d'une heure : une période en jours calendaires qui couvre un passage à l'heure d'hiver
 * dure une heure de plus (ex. « 7 jours » du 23/10 0 h au 29/10 23 h en France). */
const DST_MARGIN_MS = 3_600_000;

const schema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});

export interface Period {
  from: Date;
  to: Date;
}

/**
 * Désactivé à la demande de l'utilisateur (2026-10-29) : le client voit tout l'historique Traccar du
 * traceur. Risque connu : un traceur réaffecté montre au nouveau client les trajets de l'ancien
 * (données personnelles). Passer à true pour borner l'historique à vehicles.historyStartAt.
 */
export const LIMIT_HISTORY_TO_ASSIGNMENT = false;

/**
 * Un traceur peut être retiré à un client puis affecté à un autre : quand la limite est active,
 * l'historique visible commence à historyStartAt (par défaut l'affectation au client actuel).
 * Renvoie null si la période est entièrement antérieure à cette date.
 */
export function clampToAssignment(period: Period, assignedAt: Date, enabled = LIMIT_HISTORY_TO_ASSIGNMENT): Period | null {
  if (!enabled) return period;
  const from = period.from < assignedAt ? assignedAt : period.from;
  return from < period.to ? { from, to: period.to } : null;
}

/**
 * Période d'un rapport (?from=…&to=…, ISO 8601) : bornée pour ne pas surcharger Traccar.
 * Renvoie un message d'erreur destiné au client si la période est invalide.
 */
export function parsePeriod(query: unknown, maxDays: number): Period | { error: string } {
  const parsed = schema.safeParse(query);
  if (!parsed.success) return { error: "Paramètres from et to requis (dates ISO 8601)" };
  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);
  if (to <= from) return { error: "La date de fin doit suivre la date de début" };
  if (to.getTime() - from.getTime() > maxDays * DAY_MS + DST_MARGIN_MS) {
    return { error: `Période limitée à ${maxDays} jours` };
  }
  return { from, to };
}
