import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../lib/prisma.js";

// Tâche planifiée de l'API : une passe toutes les 5 minutes, plus une passe quotidienne par client à
// 07:00 dans son fuseau. Chaque tâche doit être idempotente (alertes dédoublonnées par dedupKey,
// voir recordAppEvent) : une passe rejouée (redémarrage, chevauchement) ne crée aucun doublon.
// Une seule instance de l'API aujourd'hui ; si elle est un jour répliquée, ajouter un verrou en base
// (GET_LOCK de MySQL) autour de runScheduledPass.

export const PASS_INTERVAL_MS = 5 * 60_000;
/** Heure locale (fuseau du client) de la passe quotidienne. */
export const DAILY_HOUR = 7;

export interface TaskContext {
  now: Date;
  log: FastifyBaseLogger;
}

export interface TenantTaskContext extends TaskContext {
  tenant: { id: string; timezone: string };
  /** Date du jour dans le fuseau du client (AAAA-MM-JJ). */
  localDate: string;
}

export interface ScheduledTasks {
  /** À chaque passe (toutes les 5 minutes). */
  frequent: ((ctx: TaskContext) => Promise<void>)[];
  /** Une fois par jour et par client, à partir de DAILY_HOUR dans son fuseau. */
  daily: ((ctx: TenantTaskContext) => Promise<void>)[];
}

/**
 * Tâches enregistrées. Vide au socle (M1) : les tranches suivantes y ajoutent les échéances (M3),
 * l'entretien (M4) et les alertes de location (M6).
 */
export const tasks: ScheduledTasks = { frequent: [], daily: [] };

/** Date et heure locales d'un instant dans un fuseau IANA. */
export function localParts(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/** Dernière journée traitée par client (en mémoire : après un redémarrage, la passe est rejouée sans doublon). */
const lastDailyRun = new Map<string, string>();

export function resetSchedulerState() {
  lastDailyRun.clear();
}

/** Une passe complète. Appelée par la boucle en production et directement par les tests. */
export async function runScheduledPass(now: Date, log: FastifyBaseLogger, registry: ScheduledTasks = tasks): Promise<void> {
  for (const task of registry.frequent) {
    try {
      await task({ now, log });
    } catch (err) {
      log.error({ err }, "Échec d'une tâche planifiée");
    }
  }
  if (registry.daily.length === 0) return;

  const tenants = await prisma.tenant.findMany({ where: { status: "ACTIVE" }, select: { id: true, timezone: true } });
  for (const tenant of tenants) {
    let local: { date: string; hour: number };
    try {
      local = localParts(now, tenant.timezone);
    } catch {
      // Fuseau invalide en base (ne devrait pas arriver : validé à l'écriture) : on prend celui par défaut.
      local = localParts(now, "Africa/Casablanca");
    }
    if (local.hour < DAILY_HOUR || lastDailyRun.get(tenant.id) === local.date) continue;
    let ok = true;
    for (const task of registry.daily) {
      try {
        await task({ now, log, tenant, localDate: local.date });
      } catch (err) {
        ok = false;
        log.error({ err, tenantId: tenant.id }, "Échec d'une tâche quotidienne");
      }
    }
    // En cas d'échec, la journée sera retentée à la passe suivante.
    if (ok) lastDailyRun.set(tenant.id, local.date);
  }
}

/** Lance la boucle (jamais en test). Renvoie la fonction d'arrêt. */
export function startScheduler(log: FastifyBaseLogger): () => void {
  let running = false;
  const tick = async () => {
    if (running) return; // passe précédente encore en cours
    running = true;
    try {
      await runScheduledPass(new Date(), log);
    } catch (err) {
      log.error({ err }, "Échec de la passe planifiée");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), PASS_INTERVAL_MS);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
