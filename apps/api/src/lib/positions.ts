import type { FastifyBaseLogger } from "fastify";
import { isPlausibleTrip, traccar, type TraccarPosition, type TraccarTrip } from "./traccar.js";

// Sauts au point 0,0 : un traceur sans fix GPS envoie parfois la position 0,0. Décision de
// l'utilisateur (2026-11-17) : ces positions prennent les coordonnées de la dernière position
// connue. Le tracé ne part donc plus dans le golfe de Guinée, et la distance d'un trajet faussé
// est recalculée à partir de ses positions ainsi corrigées.

const isZero = (p: Pick<TraccarPosition, "latitude" | "longitude">) => p.latitude === 0 && p.longitude === 0;

/**
 * Remplace les coordonnées des positions 0,0 par celles de la dernière position connue (les autres
 * champs, dont la date, sont conservés). Les positions 0,0 qui précèdent toute position connue
 * sont écartées. Les positions doivent être triées par date (c'est le cas des rapports Traccar).
 */
export function fillZeroPositions<T extends Pick<TraccarPosition, "latitude" | "longitude">>(positions: T[]): T[] {
  const filled: T[] = [];
  let last: T | undefined;
  for (const p of positions) {
    if (!isZero(p)) {
      last = p;
      filled.push(p);
    } else if (last) {
      filled.push({ ...p, latitude: last.latitude, longitude: last.longitude });
    }
  }
  return filled;
}

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Distance à vol d'oiseau entre deux points, en mètres (formule de haversine). */
export function haversineMeters(
  a: Pick<TraccarPosition, "latitude" | "longitude">,
  b: Pick<TraccarPosition, "latitude" | "longitude">,
): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Longueur d'un tracé, en mètres. */
export function pathMeters(points: Pick<TraccarPosition, "latitude" | "longitude">[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1]!, points[i]!);
  return total;
}

export interface CorrectedTrip {
  /** Distance recalculée, en mètres. */
  distance: number;
  start: { latitude: number; longitude: number };
  end: { latitude: number; longitude: number };
}

// Les trajets passés ne changent plus : le recalcul est gardé en mémoire. Une promesse par trajet,
// pour que deux demandes simultanées ne lancent qu'un seul rapport Traccar.
const MAX_ENTRIES = 2_000;
const cache = new Map<string, Promise<CorrectedTrip | null>>();

/** Au plus quelques rapports « route » en parallèle : Traccar sert aussi le suivi en direct. */
const MAX_PARALLEL = 3;
let running = 0;
const waiting: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

async function recompute(trip: TraccarTrip): Promise<CorrectedTrip | null> {
  const positions = await limited(() =>
    traccar.getReport("route", [trip.deviceId], new Date(trip.startTime), new Date(trip.endTime)),
  );
  const points = fillZeroPositions(positions.filter((p) => p.valid !== false));
  if (points.length < 2) return null;
  const corrected = { distance: pathMeters(points), start: points[0]!, end: points.at(-1)! };
  // Encore impossible après correction (autre type de saut) : on ne l'affiche pas.
  if (!isPlausibleTrip({ distance: corrected.distance, duration: trip.duration, maxSpeed: trip.maxSpeed })) return null;
  return {
    distance: corrected.distance,
    start: { latitude: corrected.start.latitude, longitude: corrected.start.longitude },
    end: { latitude: corrected.end.latitude, longitude: corrected.end.longitude },
  };
}

/**
 * Distance et extrémités d'un trajet faussé par un saut au point 0,0, recalculées à partir de ses
 * positions. null si le recalcul est impossible (Traccar indisponible, trop peu de positions).
 */
export function correctTrip(trip: TraccarTrip, log: FastifyBaseLogger): Promise<CorrectedTrip | null> {
  const key = `${trip.deviceId}|${trip.startTime}|${trip.endTime}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = recompute(trip).catch((err: unknown) => {
    log.warn({ err }, "Échec du recalcul de la distance d'un trajet");
    // Un échec n'est pas gardé : on retentera à la prochaine consultation.
    if (cache.get(key) === pending) cache.delete(key);
    return null;
  });
  cache.set(key, pending);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return pending;
}

/** Distance fiable d'un trajet, en mètres : celle de Traccar, ou recalculée si elle est faussée. */
export async function reliableTrip(trip: TraccarTrip, log: FastifyBaseLogger): Promise<CorrectedTrip | null> {
  if (isPlausibleTrip(trip)) {
    return {
      distance: trip.distance,
      start: { latitude: trip.startLat, longitude: trip.startLon },
      end: { latitude: trip.endLat, longitude: trip.endLon },
    };
  }
  return correctTrip(trip, log);
}

/** Vide le cache (tests). */
export function resetTripCache() {
  cache.clear();
}
