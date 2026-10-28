import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { tenantScope, vehicleSelect, withLiveData, type VehicleRow } from "../lib/fleet.js";
import { clampToAssignment, parsePeriod } from "../lib/period.js";
import { prisma } from "../lib/prisma.js";
import { knotsToKmh, traccar } from "../lib/traccar.js";

const TRIPS_MAX_DAYS = 31;
const ROUTE_MAX_DAYS = 7;
/** Au-delà, le tracé est sous-échantillonné : inutile d'envoyer des dizaines de milliers de points. */
const ROUTE_MAX_POINTS = 2000;

const idParams = z.object({ id: z.string().regex(/^[a-z0-9]{1,64}$/) });

/** Rapports Traccar coûteux : limite propre, bien au-dessus de l'usage normal de l'application. */
export const REPORT_RATE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } };

/**
 * Véhicule demandé, s'il appartient au client connecté. Un véhicule d'un autre client
 * est traité exactement comme un véhicule inexistant (404) : on ne révèle pas son existence.
 */
export async function findOwnedVehicle(request: FastifyRequest): Promise<VehicleRow | null> {
  const parsed = idParams.safeParse(request.params);
  if (!parsed.success) return null;
  return prisma.vehicle.findFirst({
    where: { id: parsed.data.id, ...tenantScope(request.currentUser!) },
    select: vehicleSelect,
  });
}

/** Garde un point sur n pour rester sous la limite, en conservant toujours le dernier. */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const kept = points.filter((_, i) => i % step === 0);
  if (kept[kept.length - 1] !== points[points.length - 1]) kept.push(points[points.length - 1]!);
  return kept;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const vehicleRoutes: FastifyPluginAsync = async (app) => {
  // Véhicules du client connecté, complétés par l'état et la dernière position Traccar.
  app.get("/vehicles", { preHandler: app.requireAuth }, async (request) => {
    const user = request.currentUser!;
    const vehicles = await prisma.vehicle.findMany({
      where: tenantScope(user),
      select: vehicleSelect,
      orderBy: { name: "asc" },
    });
    return withLiveData(vehicles, request.log, user);
  });

  app.get("/vehicles/:id", { preHandler: app.requireAuth }, async (request, reply) => {
    const vehicle = await findOwnedVehicle(request);
    if (!vehicle) return reply.notFound();
    const { liveDataAvailable, vehicles } = await withLiveData([vehicle], request.log, request.currentUser!);
    return { liveDataAvailable, vehicle: vehicles[0] };
  });

  // Trajets sur une période (rapport « trips » de Traccar).
  app.get("/vehicles/:id/trips", { preHandler: app.requireAuth, config: REPORT_RATE_LIMIT }, async (request, reply) => {
    const vehicle = await findOwnedVehicle(request);
    if (!vehicle) return reply.notFound();
    const requested = parsePeriod(request.query, TRIPS_MAX_DAYS);
    if ("error" in requested) return reply.badRequest(requested.error);
    const period = clampToAssignment(requested, vehicle.historyStartAt);
    if (!period) return { trips: [] };

    let trips;
    try {
      trips = await traccar.getReport("trips", [vehicle.traccarDeviceId], period.from, period.to);
    } catch (err) {
      request.log.error({ err }, "Échec du rapport de trajets Traccar");
      return reply.serviceUnavailable("Historique momentanément indisponible");
    }

    return {
      trips: trips.map((t) => ({
        startTime: t.startTime,
        endTime: t.endTime,
        durationMs: t.duration,
        distanceKm: round1(t.distance / 1000),
        averageSpeedKmh: knotsToKmh(t.averageSpeed),
        maxSpeedKmh: knotsToKmh(t.maxSpeed),
        start: { latitude: t.startLat, longitude: t.startLon, address: t.startAddress },
        end: { latitude: t.endLat, longitude: t.endLon, address: t.endAddress },
      })),
    };
  });

  // Tracé GPS sur une période (rapport « route » de Traccar), sous-échantillonné.
  app.get("/vehicles/:id/route", { preHandler: app.requireAuth, config: REPORT_RATE_LIMIT }, async (request, reply) => {
    const vehicle = await findOwnedVehicle(request);
    if (!vehicle) return reply.notFound();
    const requested = parsePeriod(request.query, ROUTE_MAX_DAYS);
    if ("error" in requested) return reply.badRequest(requested.error);
    const period = clampToAssignment(requested, vehicle.historyStartAt);
    if (!period) return { truncated: false, points: [] };

    let positions;
    try {
      positions = await traccar.getReport("route", [vehicle.traccarDeviceId], period.from, period.to);
    } catch (err) {
      request.log.error({ err }, "Échec du rapport de parcours Traccar");
      return reply.serviceUnavailable("Historique momentanément indisponible");
    }

    const valid = positions.filter((p) => p.valid !== false);
    return {
      truncated: valid.length > ROUTE_MAX_POINTS,
      points: downsample(valid, ROUTE_MAX_POINTS).map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        speedKmh: knotsToKmh(p.speed),
        fixTime: p.fixTime,
      })),
    };
  });
};

export default vehicleRoutes;
