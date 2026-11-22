import type { TenantTaskContext } from "../jobs/scheduler.js";
import { config } from "../config.js";
import { prisma } from "./prisma.js";

// Purge des anciens événements et alertes. Désactivée tant que EVENTS_RETENTION_DAYS n'est pas
// défini dans le .env : effacer des données de production demande l'accord explicite du client.

export const RETENTION_MIN_DAYS = 30;
const BATCH = 5_000;

/** Durée de conservation configurée, ou null (purge désactivée ou valeur invalide). */
export function retentionDays(raw: string | undefined = config.EVENTS_RETENTION_DAYS): number | null {
  if (raw == null || raw.trim() === "") return null;
  const days = Number(raw);
  return Number.isInteger(days) && days >= RETENTION_MIN_DAYS && days <= 3650 ? days : null;
}

/** Tâche quotidienne par client : supprime ses événements plus anciens que la durée de conservation. */
export async function eventPurgeTask({ tenant, now, log }: TenantTaskContext, raw?: string): Promise<void> {
  const days = retentionDays(raw ?? config.EVENTS_RETENTION_DAYS);
  if (days == null) {
    if (config.EVENTS_RETENTION_DAYS) log.warn("EVENTS_RETENTION_DAYS invalide (entier de 30 à 3650 attendu) : purge des événements désactivée");
    return;
  }
  const before = new Date(now.getTime() - days * 86_400_000);
  let total = 0;
  // Par lots, pour ne pas verrouiller la table longtemps.
  for (;;) {
    const old = await prisma.event.findMany({ where: { tenantId: tenant.id, eventTime: { lt: before } }, select: { id: true }, take: BATCH });
    if (old.length === 0) break;
    const { count } = await prisma.event.deleteMany({ where: { id: { in: old.map((e) => e.id) } } });
    total += count;
    if (old.length < BATCH) break;
  }
  if (total > 0) log.info({ tenantId: tenant.id, deleted: total, days }, "Purge des anciens événements");
}
