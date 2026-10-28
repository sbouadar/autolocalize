import type { RoutePoint } from "./types";

export interface ReplayFrame {
  latitude: number;
  longitude: number;
  speedKmh: number;
  time: number;
}

/** Bornes temporelles (ms) d'un tracé ; null s'il a moins de deux points datés. */
export function replayBounds(points: RoutePoint[]): { start: number; end: number } | null {
  if (points.length < 2) return null;
  const start = Date.parse(points[0]!.fixTime);
  const end = Date.parse(points[points.length - 1]!.fixTime);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

/**
 * Position du véhicule à l'instant t (ms), interpolée entre les deux positions connues qui
 * l'encadrent. Les points doivent être triés par date (c'est le cas des rapports Traccar).
 */
export function frameAt(points: RoutePoint[], t: number): ReplayFrame | null {
  if (points.length === 0) return null;
  const first = points[0]!;
  if (t <= Date.parse(first.fixTime)) return { ...pick(first), time: Date.parse(first.fixTime) };
  for (let i = 1; i < points.length; i++) {
    const b = points[i]!;
    const tb = Date.parse(b.fixTime);
    if (t > tb) continue;
    const a = points[i - 1]!;
    const ta = Date.parse(a.fixTime);
    const k = tb > ta ? (t - ta) / (tb - ta) : 1;
    return {
      latitude: a.latitude + (b.latitude - a.latitude) * k,
      longitude: a.longitude + (b.longitude - a.longitude) * k,
      // Vitesse du dernier point atteint : pas d'interpolation, c'est une mesure.
      speedKmh: k < 1 ? a.speedKmh : b.speedKmh,
      time: t,
    };
  }
  const last = points[points.length - 1]!;
  return { ...pick(last), time: Date.parse(last.fixTime) };
}

function pick(p: RoutePoint) {
  return { latitude: p.latitude, longitude: p.longitude, speedKmh: p.speedKmh };
}

/** Facteurs d'accélération proposés (×60 : une heure de route en une minute). */
export const REPLAY_SPEEDS = [10, 60, 300] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];
