import { z } from "zod";

const DAY_MS = 86_400_000;

const schema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});

export interface Period {
  from: Date;
  to: Date;
}

/**
 * Un traceur peut être retiré à un client puis affecté à un autre : l'historique visible commence
 * à son affectation au client actuel, jamais avant (sinon fuite de données de l'ancien client).
 * Renvoie null si la période est entièrement antérieure à l'affectation.
 */
export function clampToAssignment(period: Period, assignedAt: Date): Period | null {
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
  if (to.getTime() - from.getTime() > maxDays * DAY_MS) {
    return { error: `Période limitée à ${maxDays} jours` };
  }
  return { from, to };
}
