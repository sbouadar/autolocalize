import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { prisma } from "../src/lib/prisma.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const ASSIGNED = new Date("2026-01-01T00:00:00Z");
const range = `from=${encodeURIComponent("2026-10-27T00:00:00Z")}&to=${encodeURIComponent("2026-10-28T00:00:00Z")}`;

const trip = (deviceId: number, duration: number) => ({
  deviceId,
  startTime: "2026-10-27T08:00:00Z",
  endTime: "2026-10-27T09:00:00Z",
  distance: 1000,
  averageSpeed: 10,
  maxSpeed: 20,
  duration,
});

describe("GET /api/dashboard/kpis", () => {
  let alice: Record<string, string>;

  beforeEach(async () => {
    await resetState(ctx);
    const a = await createTenant("alpha");
    const b = await createTenant("bravo");
    await createUser("alice@alpha.test", "TENANT_ADMIN", a.id);
    await prisma.vehicle.createMany({
      data: [
        { tenantId: a.id, traccarDeviceId: 1, name: "Roule", historyStartAt: ASSIGNED },
        { tenantId: a.id, traccarDeviceId: 2, name: "Garé", historyStartAt: ASSIGNED },
        { tenantId: a.id, traccarDeviceId: 3, name: "Éteint", historyStartAt: ASSIGNED },
        { tenantId: b.id, traccarDeviceId: 9, name: "Autre client", historyStartAt: ASSIGNED },
      ],
    });
    ctx.traccar.devices = [
      device({ id: 1 }),
      device({ id: 2 }),
      device({ id: 3, status: "offline" }),
      device({ id: 9 }),
    ];
    ctx.traccar.positions = [
      position({ deviceId: 1, speed: 30, attributes: { motion: true } }),
      position({ deviceId: 2, speed: 0, attributes: { motion: false } }),
      position({ deviceId: 3, speed: 0 }),
      position({ deviceId: 9, speed: 50 }),
    ];
    ctx.traccar.reports.summary = [
      { deviceId: 1, distance: 52_340, averageSpeed: 20, maxSpeed: 60, engineHours: 7_200_000 },
      { deviceId: 2, distance: 1_000, averageSpeed: 5, maxSpeed: 10, engineHours: 600_000 },
      { deviceId: 9, distance: 999_999, averageSpeed: 50, maxSpeed: 99, engineHours: 1 },
    ];
    ctx.traccar.reports.trips = [trip(1, 3_600_000), trip(1, 1_800_000), trip(2, 600_000), trip(9, 1)];
    alice = await login(ctx.app, "alice@alpha.test");
  });

  it("agrège la flotte et l'activité du seul client connecté", async () => {
    const res = await call(ctx.app, "GET", `/api/dashboard/kpis?${range}`, alice);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.fleet, { total: 3, online: 2, offline: 1, unknown: 0, moving: 1 });
    assert.deepEqual(res.json.totals, {
      distanceKm: 53.3,
      drivingMs: 6_000_000,
      engineHoursMs: 7_800_000,
      maxSpeedKmh: 111.1,
      trips: 3,
    });
    assert.deepEqual(
      res.json.vehicles.map((v: { name: string; trips: number }) => [v.name, v.trips]),
      [
        ["Roule", 2],
        ["Garé", 1],
        ["Éteint", 0],
      ],
    );
    // Le rapport n'a été demandé que pour les traceurs du client.
    const sent = ctx.traccar.requests.find((r) => r.path === "/api/reports/summary")!;
    assert.deepEqual(sent.query.getAll("deviceId").sort(), ["1", "2", "3"]);
  });

  it("compte toute la période, même avant l'affectation (limite désactivée)", async () => {
    await prisma.vehicle.updateMany({ where: { name: "Garé" }, data: { historyStartAt: new Date("2026-10-27T18:00:00Z") } });
    ctx.traccar.requests = [];
    const res = await call(ctx.app, "GET", `/api/dashboard/kpis?${range}`, alice);
    assert.equal(res.status, 200);
    const summaries = ctx.traccar.requests.filter((r) => r.path === "/api/reports/summary");
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]!.query.get("from"), "2026-10-27T00:00:00.000Z");
    assert.equal(res.json.totals.trips, 3);
  });

  it("garde l'état de la flotte si les rapports échouent", async () => {
    ctx.traccar.down = true;
    const res = await call(ctx.app, "GET", `/api/dashboard/kpis?${range}`, alice);
    assert.equal(res.status, 200);
    assert.equal(res.json.reportsAvailable, false);
    assert.equal(res.json.liveDataAvailable, false);
    assert.equal(res.json.totals, null);
    assert.equal(res.json.fleet.total, 3);
  });

  it("valide la période et exige une session", async () => {
    assert.equal((await call(ctx.app, "GET", "/api/dashboard/kpis", alice)).status, 400);
    assert.equal((await call(ctx.app, "GET", `/api/dashboard/kpis?${range}`, null)).status, 401);
  });

  it("répond sans appeler Traccar pour un client sans véhicule", async () => {
    const c = await createTenant("charlie");
    await createUser("carl@charlie.test", "VIEWER", c.id);
    const carl = await login(ctx.app, "carl@charlie.test");
    ctx.traccar.requests = [];
    const res = await call(ctx.app, "GET", `/api/dashboard/kpis?${range}`, carl);
    assert.equal(res.status, 200);
    assert.equal(res.json.fleet.total, 0);
    assert.equal(res.json.totals.trips, 0);
    assert.ok(!ctx.traccar.requests.some((r) => r.path.startsWith("/api/reports")));
  });
});
