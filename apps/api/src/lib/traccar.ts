import { config } from "../config.js";

// Client minimal de l'API REST Traccar, authentifié avec le jeton du compte de service.
// Ce module ne doit jamais être exposé tel quel : les routes filtrent toujours par tenant.

export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
  status: "online" | "offline" | "unknown";
  disabled: boolean;
  lastUpdate: string | null;
  positionId: number;
  groupId: number;
  expirationTime: string | null;
  attributes: Record<string, unknown>;
}

export interface TraccarPosition {
  id: number;
  deviceId: number;
  fixTime: string;
  serverTime: string;
  valid: boolean;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number; // en nœuds
  course: number;
  address: string | null;
  attributes: Record<string, unknown> & {
    ignition?: boolean;
    motion?: boolean;
    totalDistance?: number;
    batteryLevel?: number;
  };
}

export class TraccarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TraccarError";
  }
}

const TIMEOUT_MS = 10_000;

async function request<T>(path: string, query?: URLSearchParams): Promise<T> {
  const url = new URL(`/api${path}`, config.TRACCAR_URL);
  if (query) url.search = query.toString();

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.TRACCAR_TOKEN}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new TraccarError(`Traccar ${path} : HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

function idsQuery(ids: number[]): URLSearchParams {
  const query = new URLSearchParams();
  for (const id of ids) query.append("id", String(id));
  return query;
}

// Traccar applique les droits de rattachement à /devices?id=… même pour un admin ;
// seul all=true les ignore. On charge donc tous les appareils, avec un cache court.
const DEVICES_TTL_MS = 5_000;
let devicesCache: { at: number; data: Promise<Map<number, TraccarDevice>> } | null = null;

function allDevices(): Promise<Map<number, TraccarDevice>> {
  if (!devicesCache || Date.now() - devicesCache.at > DEVICES_TTL_MS) {
    const data = request<TraccarDevice[]>("/devices", new URLSearchParams({ all: "true" })).then(
      (list) => new Map(list.map((d) => [d.id, d])),
    );
    // En cas d'échec, on ne garde pas la promesse rejetée en cache.
    data.catch(() => {
      devicesCache = null;
    });
    devicesCache = { at: Date.now(), data };
  }
  return devicesCache.data;
}

export const traccar = {
  /** Appareils par identifiant Traccar. */
  async getDevices(ids: number[]): Promise<TraccarDevice[]> {
    if (ids.length === 0) return [];
    const devices = await allDevices();
    return ids.flatMap((id) => devices.get(id) ?? []);
  },

  /** Positions par identifiant de position (dernière position connue de chaque appareil). */
  async getPositions(positionIds: number[]): Promise<TraccarPosition[]> {
    const ids = positionIds.filter((id) => id > 0);
    if (ids.length === 0) return [];
    return request<TraccarPosition[]>("/positions", idsQuery(ids));
  },
};

export const knotsToKmh = (knots: number) => Math.round(knots * 1.852 * 10) / 10;
