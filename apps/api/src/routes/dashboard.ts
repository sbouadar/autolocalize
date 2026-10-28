import type { FastifyPluginAsync } from "fastify";
import { tenantScope, vehicleSelect, withLiveData } from "../lib/fleet.js";
import { clampToAssignment, parsePeriod } from "../lib/period.js";
import { REPORT_RATE_LIMIT } from "./vehicles.js";
import { prisma } from "../lib/prisma.js";
import { knotsToKmh, traccar, type TraccarSummary, type TraccarTrip } from "../lib/traccar.js";

const KPI_MAX_DAYS = 31;
/** Même seuil que l'application : en dessous, sans attribut « motion », le véhicule est à l'arrêt. */
const MOVING_SPEED_KMH = 3;

const round1 = (n: number) => Math.round(n * 10) / 10;

const dashboardRoutes: FastifyPluginAsync = async (app) => {
  // Indicateurs de la flotte du client : état actuel + activité sur la période (rapports Traccar).
  app.get("/dashboard/kpis", { preHandler: app.requireAuth, config: REPORT_RATE_LIMIT }, async (request, reply) => {
    const user = request.currentUser!;
    const period = parsePeriod(request.query, KPI_MAX_DAYS);
    if ("error" in period) return reply.badRequest(period.error);

    const rows = await prisma.vehicle.findMany({ where: tenantScope(user), select: vehicleSelect, orderBy: { name: "asc" } });
    const live = await withLiveData(rows, request.log, user);

    const fleet = { total: rows.length, online: 0, offline: 0, unknown: 0, moving: 0 };
    for (const v of live.vehicles) {
      fleet[v.status] += 1;
      const p = v.position;
      if (v.status === "online" && p && (p.motion ?? p.speedKmh >= MOVING_SPEED_KMH)) fleet.moving += 1;
    }

    // Chaque traceur n'est compté qu'à partir de son affectation au client (jamais l'activité
    // d'un ancien client) : un appel Traccar par date de début distincte, en général un seul.
    const windows = new Map<number, { from: Date; deviceIds: number[] }>();
    for (const r of rows) {
      const own = clampToAssignment(period, r.historyStartAt);
      if (!own) continue;
      const key = own.from.getTime();
      const window = windows.get(key) ?? { from: own.from, deviceIds: [] };
      window.deviceIds.push(r.traccarDeviceId);
      windows.set(key, window);
    }

    let summaries: TraccarSummary[] = [];
    let trips: TraccarTrip[] = [];
    let reportsAvailable = true;
    try {
      const results = await Promise.all(
        [...windows.values()].map((w) =>
          Promise.all([
            traccar.getReport("summary", w.deviceIds, w.from, period.to),
            traccar.getReport("trips", w.deviceIds, w.from, period.to),
          ]),
        ),
      );
      summaries = results.flatMap(([s]) => s);
      trips = results.flatMap(([, t]) => t);
    } catch (err) {
      request.log.error({ err }, "Échec des rapports Traccar du tableau de bord");
      reportsAvailable = false;
    }

    const perVehicle = rows.map((r) => {
      const summary = summaries.find((s) => s.deviceId === r.traccarDeviceId);
      const own = trips.filter((t) => t.deviceId === r.traccarDeviceId);
      return {
        id: r.id,
        name: r.name,
        plate: r.plate,
        distanceKm: round1((summary?.distance ?? 0) / 1000),
        drivingMs: own.reduce((sum, t) => sum + t.duration, 0),
        engineHoursMs: summary?.engineHours ?? 0,
        maxSpeedKmh: knotsToKmh(summary?.maxSpeed ?? 0),
        trips: own.length,
      };
    });

    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      liveDataAvailable: live.liveDataAvailable,
      reportsAvailable,
      fleet,
      totals: reportsAvailable
        ? {
            distanceKm: round1(perVehicle.reduce((sum, v) => sum + v.distanceKm, 0)),
            drivingMs: perVehicle.reduce((sum, v) => sum + v.drivingMs, 0),
            engineHoursMs: perVehicle.reduce((sum, v) => sum + v.engineHoursMs, 0),
            maxSpeedKmh: Math.max(0, ...perVehicle.map((v) => v.maxSpeedKmh)),
            trips: perVehicle.reduce((sum, v) => sum + v.trips, 0),
          }
        : null,
      // Classement par distance parcourue, du plus actif au moins actif.
      vehicles: reportsAvailable ? perVehicle.sort((a, b) => b.distanceKm - a.distanceKm) : [],
    };
  });
};

export default dashboardRoutes;
