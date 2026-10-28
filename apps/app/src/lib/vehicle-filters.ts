import { sortVehicles } from "./map";
import type { Vehicle } from "./types";
import { isMoving, lastSeen, vehicleLabel } from "./vehicles";

export type StatusFilter = "all" | "online" | "moving" | "offline";
export type SortKey = "status" | "name" | "activity";

export interface VehicleFilters {
  query: string;
  status: StatusFilter;
  sort: SortKey;
}

export const DEFAULT_FILTERS: VehicleFilters = { query: "", status: "all", sort: "status" };

export const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "online", label: "En ligne" },
  { key: "moving", label: "En route" },
  { key: "offline", label: "Hors ligne" },
];

export const SORT_KEYS: { key: SortKey; label: string }[] = [
  { key: "status", label: "Statut" },
  { key: "name", label: "Nom" },
  { key: "activity", label: "Activité" },
];

/** Minuscules sans accents ni séparateurs : « AB-123 cd » et « ab123CD » se retrouvent. */
function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s\-_.]/g, "");
}

export function matchesQuery(v: Pick<Vehicle, "name" | "plate">, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return [v.name, v.plate].some((field) => field != null && normalize(field).includes(q));
}

export function matchesStatus(v: Vehicle, status: StatusFilter): boolean {
  const online = v.status === "online" && !v.disabled;
  switch (status) {
    case "all":
      return true;
    case "online":
      return online;
    case "moving":
      return online && isMoving(v.position);
    case "offline":
      return !online;
  }
}

function byName(a: Vehicle, b: Vehicle): number {
  return vehicleLabel(a).localeCompare(vehicleLabel(b), "fr", { numeric: true, sensitivity: "base" });
}

/** Plus récente activité d'abord ; les véhicules jamais vus en dernier. */
function byActivity(a: Vehicle, b: Vehicle): number {
  const ta = Date.parse(lastSeen(a) ?? "") || 0;
  const tb = Date.parse(lastSeen(b) ?? "") || 0;
  return tb - ta || byName(a, b);
}

export function applyFilters(vehicles: Vehicle[], filters: VehicleFilters): Vehicle[] {
  const kept = vehicles.filter((v) => matchesQuery(v, filters.query) && matchesStatus(v, filters.status));
  switch (filters.sort) {
    case "status":
      return sortVehicles(kept);
    case "name":
      return [...kept].sort(byName);
    case "activity":
      return [...kept].sort(byActivity);
  }
}

export function isFiltered(filters: VehicleFilters): boolean {
  return filters.query.trim() !== "" || filters.status !== "all";
}
