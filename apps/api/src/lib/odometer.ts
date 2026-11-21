import type { FastifyBaseLogger } from "fastify";
import { prisma } from "./prisma.js";
import { reliableTrip } from "./positions.js";
import { traccar } from "./traccar.js";

// Compteur kilométrique estimé = dernier relevé + distance GPS parcourue depuis.
// La distance GPS est la somme des trajets Traccar, les trajets faussés par un saut au point 0,0
// étant recalculés (reliableTrip) ; un trajet impossible à recalculer est ignoré et signalé.

/** Au-delà, le relevé est trop ancien pour additionner les trajets : il faut un nouveau relevé. */
export const ESTIMATE_MAX_DAYS = 366;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 2_000;

export interface OdometerEstimate {
  /** Dernier relevé + distance GPS depuis ; null sans relevé ou si la distance est indisponible. */
  estimatedKm: number | null;
  /** Distance GPS parcourue depuis le dernier relevé. */
  gpsKmSinceReading: number | null;
  /** Des trajets n'ont pas pu être comptés (faussés et non recalculables) : estimation par défaut. */
  partial: boolean;
  /** Traccar injoignable, ou relevé trop ancien : seule la valeur du dernier relevé est connue. */
  unavailableReason: "TRACCAR_UNAVAILABLE" | "READING_TOO_OLD" | null;
}

const cache = new Map<string, { at: number; value: OdometerEstimate }>();

export function resetOdometerCache() {
  cache.clear();
}

export async function estimateOdometer(
  vehicle: { id: string; traccarDeviceId: number },
  log: FastifyBaseLogger,
  now = new Date(),
): Promise<{ lastReading: { id: string; km: number; readAt: Date; source: string } | null; estimate: OdometerEstimate }> {
  const lastReading = await prisma.odometerReading.findFirst({
    where: { vehicleId: vehicle.id },
    orderBy: [{ readAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, km: true, readAt: true, source: true },
  });
  if (!lastReading) {
    return { lastReading: null, estimate: { estimatedKm: null, gpsKmSinceReading: null, partial: false, unavailableReason: null } };
  }
  if (now.getTime() - lastReading.readAt.getTime() > ESTIMATE_MAX_DAYS * 86_400_000) {
    return {
      lastReading,
      estimate: { estimatedKm: null, gpsKmSinceReading: null, partial: false, unavailableReason: "READING_TOO_OLD" },
    };
  }

  // Le cache dépend du relevé : un nouveau relevé invalide l'estimation précédente.
  const key = `${vehicle.id}:${lastReading.id}`;
  const cached = cache.get(key);
  if (cached && now.getTime() - cached.at < CACHE_TTL_MS) return { lastReading, estimate: cached.value };

  let estimate: OdometerEstimate;
  try {
    const trips = await traccar.getReport("trips", [vehicle.traccarDeviceId], lastReading.readAt, now);
    const reliable = await Promise.all(trips.map((t) => reliableTrip(t, log)));
    const meters = reliable.reduce((sum, t) => sum + (t?.distance ?? 0), 0);
    const gpsKm = Math.round(meters / 1000);
    estimate = {
      estimatedKm: lastReading.km + gpsKm,
      gpsKmSinceReading: gpsKm,
      partial: reliable.some((t) => t === null),
      unavailableReason: null,
    };
  } catch (err) {
    log.error({ err }, "Échec du calcul du compteur estimé");
    // Pas de mise en cache : la prochaine demande retentera.
    return {
      lastReading,
      estimate: { estimatedKm: null, gpsKmSinceReading: null, partial: false, unavailableReason: "TRACCAR_UNAVAILABLE" },
    };
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, { at: now.getTime(), value: estimate });
  return { lastReading, estimate };
}
