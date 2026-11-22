import type { FastifyPluginAsync } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { ALERT_TYPES, recordTraccarEvent } from "../lib/events.js";
import { tenantScope } from "../lib/fleet.js";
import { assignmentsDuring, driverAt, driversEnabled } from "../lib/drivers.js";
import { prisma } from "../lib/prisma.js";
import { mutedTypesOf } from "./alert-rules.js";

const SECRET_HEADER = "x-events-secret";

function secretMatches(received: unknown): boolean {
  const expected = config.TRACCAR_EVENTS_SECRET;
  if (!expected || typeof received !== "string") return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const alertsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // Pagination : alertes strictement antérieures à cette date.
  before: z.iso.datetime({ offset: true }).optional(),
  vehicleId: z.string().regex(/^[a-z0-9]{1,64}$/).optional(),
  /** true : ignore les types masqués par l'utilisateur. */
  all: z.enum(["true", "false"]).optional(),
});

const eventRoutes: FastifyPluginAsync = async (app) => {
  // Réception des événements de Traccar (event.forward.url). Route interne : Traccar l'appelle sur
  // 127.0.0.1 et Nginx la refuse de l'extérieur ; un secret partagé la protège dans tous les cas.
  // Sans secret configuré, ou avec un mauvais secret, elle répond comme une route inexistante.
  app.post("/internal/traccar/events", { config: { rateLimit: false } }, async (request, reply) => {
    if (!secretMatches(request.headers[SECRET_HEADER])) return reply.notFound();
    const result = await recordTraccarEvent(request.body);
    if (result === "invalid") {
      request.log.warn("Événement Traccar illisible");
      return reply.badRequest("Événement illisible");
    }
    return reply.code(200).send({ result });
  });

  // Alertes du client connecté, les plus récentes d'abord.
  app.get("/alerts", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = alertsQuery.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Paramètres invalides");
    const { limit, before, vehicleId, all } = parsed.data;
    // Types d'alerte masqués par l'utilisateur dans ses préférences.
    const muted =
      all === "true"
        ? []
        : mutedTypesOf((await prisma.user.findUnique({ where: { id: request.currentUser!.id }, select: { mutedAlertTypes: true } }))?.mutedAlertTypes);

    const rows = await prisma.event.findMany({
      where: {
        ...tenantScope(request.currentUser!),
        type: { in: ALERT_TYPES.filter((t) => !muted.includes(t)) },
        ...(vehicleId && { vehicleId }),
        ...(before && { eventTime: { lt: new Date(before) } }),
      },
      orderBy: [{ eventTime: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        type: true,
        eventTime: true,
        vehicleId: true,
        vehicleName: true,
        zoneName: true,
        latitude: true,
        longitude: true,
        speedKmh: true,
        detail: true,
        message: true,
      },
    });
    const alerts = rows.slice(0, limit);
    // Module conducteurs : chaque alerte porte le conducteur affecté au véhicule à ce moment.
    if (alerts.length && (await driversEnabled(request.currentUser!.tenantId))) {
      const times = alerts.map((a) => a.eventTime.getTime());
      const vehicleIds = [...new Set(alerts.map((a) => a.vehicleId).filter((v): v is string => v != null))];
      const spans = await assignmentsDuring(vehicleIds, new Date(Math.min(...times)), new Date(Math.max(...times)));
      return {
        alerts: alerts.map((a) => ({ ...a, driverName: a.vehicleId ? (driverAt(spans, a.vehicleId, a.eventTime)?.driverName ?? null) : null })),
        hasMore: rows.length > limit,
      };
    }
    return { alerts, hasMore: rows.length > limit };
  });
};

export default eventRoutes;
