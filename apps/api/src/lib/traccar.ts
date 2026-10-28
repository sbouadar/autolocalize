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

async function request<T>(
  path: string,
  query?: URLSearchParams,
  write?: { method: "POST" | "PUT"; body: unknown },
): Promise<T> {
  const url = new URL(`/api${path}`, config.TRACCAR_URL);
  if (query) url.search = query.toString();

  const res = await fetch(url, {
    method: write?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${config.TRACCAR_TOKEN}`,
      Accept: "application/json",
      ...(write && { "Content-Type": "application/json" }),
    },
    body: write ? JSON.stringify(write.body) : undefined,
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

/** Oublie la liste d'appareils en cache (après une modification, et dans les tests). */
export function resetTraccarCache() {
  devicesCache = null;
}

export const traccar = {
  /** Tous les appareils (back-office : affectation des traceurs). */
  async listDevices(): Promise<TraccarDevice[]> {
    return [...(await allDevices()).values()];
  },

  /** Crée un groupe (un par client). */
  async createGroup(name: string): Promise<{ id: number; name: string }> {
    return request("/groups", undefined, { method: "POST", body: { name } });
  },

  /** Déclare un nouveau traceur par son identifiant (IMEI). */
  async createDevice(input: { name: string; uniqueId: string; groupId: number }): Promise<TraccarDevice> {
    const device = await request<TraccarDevice>("/devices", undefined, { method: "POST", body: input });
    resetTraccarCache();
    return device;
  },

  /** Range un appareil dans un groupe (0 : aucun). Traccar attend l'objet complet en PUT. */
  async setDeviceGroup(deviceId: number, groupId: number): Promise<void> {
    resetTraccarCache();
    const current = (await allDevices()).get(deviceId);
    if (!current) throw new TraccarError(`Appareil ${deviceId} introuvable`, 404);
    await request(`/devices/${deviceId}`, undefined, { method: "PUT", body: { ...current, groupId } });
    resetTraccarCache();
  },

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

  /** Rapport Traccar (/reports/trips, /route, /summary, /stops) sur une période. */
  async getReport<K extends keyof TraccarReports>(
    kind: K,
    deviceIds: number[],
    from: Date,
    to: Date,
  ): Promise<TraccarReports[K][]> {
    if (deviceIds.length === 0) return [];
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    for (const id of deviceIds) query.append("deviceId", String(id));
    return request<TraccarReports[K][]>(`/reports/${kind}`, query);
  },
};

// Formats des rapports Traccar : distances en mètres, vitesses en nœuds, durées en millisecondes.
export interface TraccarTrip {
  deviceId: number;
  startTime: string;
  endTime: string;
  distance: number;
  averageSpeed: number;
  maxSpeed: number;
  duration: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  startAddress: string | null;
  endAddress: string | null;
}

export interface TraccarSummary {
  deviceId: number;
  distance: number;
  averageSpeed: number;
  maxSpeed: number;
  engineHours: number;
  startTime: string | null;
  endTime: string | null;
}

export interface TraccarStop {
  deviceId: number;
  startTime: string;
  endTime: string;
  duration: number;
  latitude: number;
  longitude: number;
  address: string | null;
}

export interface TraccarReports {
  trips: TraccarTrip;
  route: TraccarPosition;
  summary: TraccarSummary;
  stops: TraccarStop;
}

export const knotsToKmh = (knots: number) => Math.round(knots * 1.852 * 10) / 10;
