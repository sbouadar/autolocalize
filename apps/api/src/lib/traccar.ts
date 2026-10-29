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
  return (await send(path, query, write)).data as T;
}

/** Appel brut : renvoie aussi le statut HTTP (202 = commande mise en file d'attente par Traccar). */
async function send(
  path: string,
  query?: URLSearchParams,
  write?: { method: "POST" | "PUT"; body: unknown },
): Promise<{ status: number; data: unknown }> {
  const { status, text } = await sendText(path, query, write);
  return { status, data: text ? (JSON.parse(text) as unknown) : null };
}

async function sendText(
  path: string,
  query?: URLSearchParams,
  write?: { method: "POST" | "PUT"; body: unknown },
): Promise<{ status: number; text: string }> {
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
  return { status: res.status, text: await res.text() };
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

  /** Types de commandes que Traccar sait envoyer à ce traceur (selon son protocole et son modèle). */
  async getCommandTypes(deviceId: number): Promise<string[]> {
    const types = await request<{ type: string }[]>("/commands/types", new URLSearchParams({ deviceId: String(deviceId) }));
    return types.map((t) => t.type);
  },

  /**
   * Envoie une commande au traceur. queued = true si le traceur est hors ligne : Traccar la garde
   * en file d'attente et la transmettra à sa prochaine connexion (HTTP 202).
   */
  async sendCommand(deviceId: number, type: string): Promise<{ queued: boolean }> {
    const { status } = await send("/commands/send", undefined, {
      method: "POST",
      body: { deviceId, type, attributes: {} },
    });
    return { queued: status === 202 };
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

  /**
   * Adresse d'un point par le géocodeur configuré dans Traccar (Nominatim, 1 requête par seconde) :
   * texte brut, vide si aucune adresse n'est trouvée. À appeler via lib/addresses.ts (cache).
   */
  async reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
    const query = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) });
    const { text } = await sendText("/server/geocode", query);
    // Traccar écrit la chaîne telle quelle ; on accepte aussi une chaîne JSON entre guillemets.
    const address = text.startsWith('"') ? (JSON.parse(text) as string) : text;
    return address.trim() || null;
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

/** Au-delà de cette vitesse moyenne, la distance d'un trajet est un artefact (voir isPlausibleTrip). */
const MAX_PLAUSIBLE_AVERAGE_KMH = 250;
/** Écart toléré entre vitesse moyenne (distance / durée) et vitesse max relevée : bruit du GPS. */
const AVERAGE_OVER_MAX_MARGIN_KMH = 30;

/**
 * Traccar calcule la distance d'un trajet par différence de la distance cumulée des positions, qui
 * compte aussi les positions aberrantes : un traceur GT06 sans fix GPS envoie parfois le point 0,0,
 * soit environ 4 000 km de saut depuis le Maroc. Ces trajets ont une vitesse moyenne impossible
 * (au-delà de 250 km/h, ou nettement au-dessus de la vitesse max relevée : 3 796 km en 16 h 52 avec
 * un max à 0 km/h) ; leur distance n'est ni affichée ni comptée. Depuis le 2026-10-29, Traccar rejette ces points
 * (filter.zero) ; l'historique antérieur, lui, reste faussé.
 */
export function isPlausibleTrip(trip: Pick<TraccarTrip, "distance" | "duration" | "maxSpeed">): boolean {
  if (trip.distance <= 0) return true;
  if (trip.duration <= 0) return false;
  const averageKmh = (trip.distance / trip.duration) * 3_600;
  return (
    averageKmh <= MAX_PLAUSIBLE_AVERAGE_KMH && averageKmh <= trip.maxSpeed * 1.852 + AVERAGE_OVER_MAX_MARGIN_KMH
  );
}
