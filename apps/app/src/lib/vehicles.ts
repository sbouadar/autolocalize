import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { VEHICLES_REFRESH_MS } from "./config";
import { formatSpeed } from "./format";
import { periodQuery, type PeriodRange } from "./period";
import { colors } from "./theme";
import {
  routeResponseSchema,
  tripsResponseSchema,
  vehicleResponseSchema,
  vehiclesResponseSchema,
  type Vehicle,
  type VehiclePosition,
} from "./types";

/** En dessous de cette vitesse, un traceur sans attribut « motion » est considéré à l'arrêt (bruit GPS). */
const MOVING_SPEED_KMH = 3;

export const VEHICLES_QUERY_KEY = ["vehicles"] as const;

export function useVehicles() {
  return useQuery({
    queryKey: VEHICLES_QUERY_KEY,
    queryFn: () => api("/vehicles", { schema: vehiclesResponseSchema }),
    refetchInterval: VEHICLES_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

export function useVehicle(id: string) {
  return useQuery({
    queryKey: [...VEHICLES_QUERY_KEY, id],
    queryFn: () => api(`/vehicles/${encodeURIComponent(id)}`, { schema: vehicleResponseSchema }),
    refetchInterval: VEHICLES_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

// Historique : pas de rafraîchissement automatique, la période est figée au moment du choix.
export function useTrips(id: string, range: PeriodRange) {
  return useQuery({
    queryKey: [...VEHICLES_QUERY_KEY, id, "trips", range],
    queryFn: () => api(`/vehicles/${encodeURIComponent(id)}/trips?${periodQuery(range)}`, { schema: tripsResponseSchema }),
    staleTime: 60_000,
  });
}

export function useRoute(id: string, range: PeriodRange) {
  return useQuery({
    queryKey: [...VEHICLES_QUERY_KEY, id, "route", range],
    queryFn: () => api(`/vehicles/${encodeURIComponent(id)}/route?${periodQuery(range)}`, { schema: routeResponseSchema }),
    staleTime: 60_000,
  });
}

/** Nom affichable : nom, sinon plaque, sinon libellé générique. */
export function vehicleLabel(v: Pick<Vehicle, "name" | "plate">): string {
  return v.name?.trim() || v.plate?.trim() || "Véhicule sans nom";
}

export function vehicleStatus(v: Pick<Vehicle, "status" | "disabled">): { label: string; color: string } {
  if (v.disabled) return { label: "Désactivé", color: colors.danger };
  switch (v.status) {
    case "online":
      return { label: "En ligne", color: colors.online };
    case "offline":
      return { label: "Hors ligne", color: colors.offline };
    default:
      return { label: "Statut inconnu", color: colors.unknown };
  }
}

/** Mouvement d'après la dernière position : attribut « motion » du traceur, sinon la vitesse. */
export function isMoving(position: VehiclePosition | null): boolean {
  if (!position) return false;
  return position.motion ?? position.speedKmh >= MOVING_SPEED_KMH;
}

/** « En mouvement · 42 km/h », « À l'arrêt » ou « Position inconnue ». */
export function movementLabel(position: VehiclePosition | null): string {
  if (!position) return "Position inconnue";
  return isMoving(position) ? `En mouvement · ${formatSpeed(position.speedKmh)}` : "À l’arrêt";
}

/** « Contact mis » / « Contact coupé » ; null si le traceur ne remonte pas l'information. */
export function ignitionLabel(ignition: boolean | null | undefined): string | null {
  if (ignition == null) return null;
  return ignition ? "Contact mis" : "Contact coupé";
}

/** Date de la dernière information connue : position si disponible, sinon dernier contact. */
export function lastSeen(v: Pick<Vehicle, "position" | "lastUpdate">): string | null {
  return v.position?.fixTime ?? v.lastUpdate;
}

export function hasPosition(v: Vehicle): v is Vehicle & { position: NonNullable<Vehicle["position"]> } {
  return v.position != null;
}
