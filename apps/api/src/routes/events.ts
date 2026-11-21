import type { FastifyPluginAsync } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { ALERT_TYPES, recordTraccarEvent } from "../lib/events.js";
import { tenantScope } from "../lib/fleet.js";
import { prisma } from "../lib/prisma.js";

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
    const { limit, before, vehicleId } = parsed.data;

    const rows = await prisma.event.findMany({
      where: {
        ...tenantScope(request.currentUser!),
        type: { in: ALERT_TYPES },
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
    return { alerts: rows.slice(0, limit), hasMore: rows.length > limit };
  });
};

export default eventRoutes;
