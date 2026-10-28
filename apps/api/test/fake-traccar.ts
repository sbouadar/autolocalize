// Faux serveur Traccar pour les tests : reproduit le sous-ensemble de l'API REST utilisé par le
// backend, avec les formats réels (distances en mètres, vitesses en nœuds, durées en ms).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { TraccarDevice, TraccarPosition } from "../src/lib/traccar.js";
import { FAKE_TRACCAR_PORT, FAKE_TRACCAR_TOKEN } from "./env.js";

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

export interface FakeTraccar {
  devices: TraccarDevice[];
  positions: TraccarPosition[];
  groups: { id: number; name: string; groupId: number; attributes: Record<string, unknown> }[];
  /** Rapports renvoyés par deviceId ; filtrés par deviceId demandé, jamais par date. */
  reports: {
    trips: Record<string, unknown>[];
    route: TraccarPosition[];
    summary: Record<string, unknown>[];
    stops: Record<string, unknown>[];
  };
  /** Types de commandes par appareil (par défaut : coupure et rétablissement du moteur). */
  commandTypes: Record<number, string[]>;
  /** Force une réponse 500 sur toutes les routes (Traccar en panne). */
  down: boolean;
  requests: FakeRequest[];
  reset(): void;
  close(): Promise<void>;
}

export function device(overrides: Partial<TraccarDevice> & { id: number }): TraccarDevice {
  return {
    name: `Device ${overrides.id}`,
    uniqueId: `86519007414${String(overrides.id).padStart(4, "0")}`,
    status: "online",
    disabled: false,
    lastUpdate: "2026-10-28T10:00:00.000+00:00",
    positionId: overrides.id * 100,
    groupId: 0,
    expirationTime: null,
    attributes: {},
    ...overrides,
  };
}

export function position(overrides: Partial<TraccarPosition> & { deviceId: number }): TraccarPosition {
  return {
    id: overrides.deviceId * 100,
    fixTime: "2026-10-28T10:00:00.000+00:00",
    serverTime: "2026-10-28T10:00:01.000+00:00",
    valid: true,
    latitude: 33.5731,
    longitude: -7.5898,
    altitude: 0,
    speed: 10,
    course: 90,
    address: null,
    attributes: { ignition: true, motion: true },
    ...overrides,
  };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

export async function startFakeTraccar(): Promise<FakeTraccar> {
  const fake: FakeTraccar = {
    devices: [],
    positions: [],
    groups: [],
    reports: { trips: [], route: [], summary: [], stops: [] },
    commandTypes: {},
    down: false,
    requests: [],
    reset() {
      this.devices = [];
      this.positions = [];
      this.groups = [];
      this.reports = { trips: [], route: [], summary: [], stops: [] };
      this.commandTypes = {};
      this.down = false;
      this.requests = [];
    },
    close: async () => {},
  };

  let nextId = 1000;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const body = await readBody(req);
    fake.requests.push({ method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body });

    if (req.headers.authorization !== `Bearer ${FAKE_TRACCAR_TOKEN}`) return send(res, 401);
    if (fake.down) return send(res, 500, { message: "java.lang.NullPointerException at ..." });

    const path = url.pathname;
    const deviceIds = url.searchParams.getAll("deviceId").map(Number);
    const byDevice = <T extends { deviceId?: unknown }>(items: T[]) =>
      items.filter((i) => deviceIds.includes(Number(i.deviceId)));

    if (req.method === "GET" && path === "/api/devices") {
      // Comme Traccar : sans all=true, les droits de rattachement s'appliquent (rien pour bff-service).
      return send(res, 200, url.searchParams.get("all") === "true" ? fake.devices : []);
    }
    if (req.method === "GET" && path === "/api/positions") {
      const ids = url.searchParams.getAll("id").map(Number);
      return send(res, 200, fake.positions.filter((p) => ids.includes(p.id)));
    }
    if (req.method === "GET" && path.startsWith("/api/reports/")) {
      if (!url.searchParams.get("from") || !url.searchParams.get("to")) return send(res, 400);
      const kind = path.slice("/api/reports/".length) as keyof FakeTraccar["reports"];
      if (!(kind in fake.reports)) return send(res, 404);
      return send(res, 200, byDevice(fake.reports[kind] as { deviceId?: unknown }[]));
    }
    if (req.method === "GET" && path === "/api/commands/types") {
      const id = Number(url.searchParams.get("deviceId"));
      const types = fake.commandTypes[id] ?? ["engineStop", "engineResume", "custom"];
      return send(res, 200, types.map((type) => ({ type })));
    }
    if (req.method === "POST" && path === "/api/commands/send") {
      const command = body as { deviceId: number; type: string };
      const target = fake.devices.find((d) => d.id === command.deviceId);
      if (!target) return send(res, 400, "Device not found");
      // Comme Traccar : 202 si le traceur est hors ligne (commande mise en file d'attente).
      return send(res, target.status === "online" ? 200 : 202, { id: nextId++, ...command });
    }
    if (req.method === "POST" && path === "/api/groups") {
      const group = { id: nextId++, groupId: 0, attributes: {}, ...(body as { name: string }) };
      fake.groups.push(group);
      return send(res, 200, group);
    }
    if (req.method === "POST" && path === "/api/devices") {
      const input = body as Partial<TraccarDevice>;
      if (fake.devices.some((d) => d.uniqueId === input.uniqueId)) return send(res, 400, "Duplicate entry");
      const created = device({ ...input, id: nextId++, status: "offline", lastUpdate: null, positionId: 0 });
      fake.devices.push(created);
      return send(res, 200, created);
    }
    const put = /^\/api\/devices\/(\d+)$/.exec(path);
    if (req.method === "PUT" && put) {
      const index = fake.devices.findIndex((d) => d.id === Number(put[1]));
      if (index < 0) return send(res, 404);
      fake.devices[index] = { ...fake.devices[index]!, ...(body as Partial<TraccarDevice>) };
      return send(res, 200, fake.devices[index]);
    }
    return send(res, 404);
  });

  await new Promise<void>((resolve) => server.listen(FAKE_TRACCAR_PORT, "127.0.0.1", resolve));
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
}
