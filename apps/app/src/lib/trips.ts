import type { RoutePoint, Trip } from "./types";

export interface TripTotals {
  count: number;
  distanceKm: number;
  durationMs: number;
  maxSpeedKmh: number;
}

export function tripTotals(trips: Trip[]): TripTotals {
  return trips.reduce<TripTotals>(
    (acc, t) => ({
      count: acc.count + 1,
      distanceKm: Math.round((acc.distanceKm + t.distanceKm) * 10) / 10,
      durationMs: acc.durationMs + t.durationMs,
      maxSpeedKmh: Math.max(acc.maxSpeedKmh, t.maxSpeedKmh),
    }),
    { count: 0, distanceKm: 0, durationMs: 0, maxSpeedKmh: 0 },
  );
}

/** Portion du tracé parcourue pendant un trajet (bornes incluses). */
export function pointsDuring(points: RoutePoint[], trip: Pick<Trip, "startTime" | "endTime">): RoutePoint[] {
  const start = Date.parse(trip.startTime);
  const end = Date.parse(trip.endTime);
  return points.filter((p) => {
    const t = Date.parse(p.fixTime);
    return t >= start && t <= end;
  });
}
