import type { Vehicle } from "./types";
import { hasPosition, vehicleLabel } from "./vehicles";

export type PositionedVehicle = Vehicle & { position: NonNullable<Vehicle["position"]> };

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Région affichée (format react-native-maps) : centre et étendue en degrés. */
export interface Region extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Vue par défaut quand aucun véhicule n'a de position : France et Maroc. */
export const DEFAULT_REGION: Region = { latitude: 39, longitude: -2, latitudeDelta: 22, longitudeDelta: 22 };
export const DEFAULT_ZOOM = 4;
/** Zoom (web) et étendue (natif) utilisés pour centrer la carte sur un véhicule. */
export const FOCUS_ZOOM = 15;
export const FOCUS_DELTA = 0.01;

const MIN_DELTA = 0.02;

export function positionedVehicles(vehicles: Vehicle[]): PositionedVehicle[] {
  return vehicles.filter(hasPosition);
}

function statusRank(v: Pick<Vehicle, "status" | "disabled">): number {
  if (v.disabled) return 3;
  return v.status === "online" ? 0 : v.status === "offline" ? 1 : 2;
}

/** En ligne d'abord, désactivés en dernier, puis ordre alphabétique. */
export function sortVehicles<T extends Pick<Vehicle, "name" | "plate" | "status" | "disabled">>(vehicles: T[]): T[] {
  return [...vehicles].sort(
    (a, b) =>
      statusRank(a) - statusRank(b) ||
      vehicleLabel(a).localeCompare(vehicleLabel(b), "fr", { numeric: true, sensitivity: "base" }),
  );
}

/** Région resserrée autour d'un point (véhicule sélectionné). */
export function focusRegion(point: LatLng): Region {
  return { latitude: point.latitude, longitude: point.longitude, latitudeDelta: FOCUS_DELTA, longitudeDelta: FOCUS_DELTA };
}

/** Région englobant tous les points, avec une marge ; vue par défaut si aucun point. */
export function regionFor(points: LatLng[]): Region {
  if (points.length === 0) return DEFAULT_REGION;
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, MIN_DELTA),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, MIN_DELTA),
  };
}
