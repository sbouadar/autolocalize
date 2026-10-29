import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { prisma } from "../src/lib/prisma.js";
import { clampToAssignment } from "../src/lib/period.js";
import { downsample } from "../src/routes/vehicles.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const FROM = "2026-10-27T00:00:00Z";
const TO = "2026-10-28T00:00:00Z";
const ASSIGNED = new Date("2026-01-01T00:00:00Z");
const range = `from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`;

describe("Fiche véhicule : /vehicles/:id, /trips, /route", () => {
  let alice: Record<string, string>;
  let mine: string;
  let theirs: string;

  beforeEach(async () => {
    await resetState(ctx);
    const a = await createTenant("alpha");
    const b = await createTenant("bravo");
    await createUser("alice@alpha.test", "TENANT_ADMIN", a.id);
    mine = (await prisma.vehicle.create({ data: { tenantId: a.id, traccarDeviceId: 1, name: "A", historyStartAt: ASSIGNED } })).id;
    theirs = (await prisma.vehicle.create({ data: { tenantId: b.id, traccarDeviceId: 2, name: "B", historyStartAt: ASSIGNED } })).id;
    ctx.traccar.devices = [device({ id: 1 }), device({ id: 2 })];
    ctx.traccar.positions = [position({ deviceId: 1 }), position({ deviceId: 2 })];
    ctx.traccar.reports.trips = [
      {
        deviceId: 1,
        startTime: "2026-10-27T08:00:00.000+00:00",
        endTime: "2026-10-27T08:30:00.000+00:00",
        distance: 12_345,
        averageSpeed: 20,
        maxSpeed: 50,
        duration: 1_800_000,
        startLat: 33.5,
        startLon: -7.6,
        endLat: 33.6,
        endLon: -7.5,
        startAddress: "Départ",
        endAddress: null,
      },
      { deviceId: 2, startTime: "x", endTime: "x", distance: 1, averageSpeed: 1, maxSpeed: 1, duration: 1 },
    ];
    ctx.traccar.reports.route = [
      position({ deviceId: 1, id: 1, speed: 0 }),
      position({ deviceId: 1, id: 2, speed: 5, valid: false }),
      position({ deviceId: 1, id: 3, speed: 10 }),
    ];
    alice = await login(ctx.app, "alice@alpha.test");
  });

  it("renvoie un véhicule du client avec ses données temps réel", async () => {
    const res = await call(ctx.app, "GET", `/api/vehicles/${mine}`, alice);
    assert.equal(res.status, 200);
    assert.equal(res.json.vehicle.name, "A");
    assert.equal(res.json.vehicle.status, "online");
  });

  it("traite le véhicule d'un autre client comme inexistant", async () => {
    for (const path of ["", "/trips?" + range, "/route?" + range]) {
      const res = await call(ctx.app, "GET", `/api/vehicles/${theirs}${path}`, alice);
      assert.equal(res.status, 404, path);
    }
    assert.equal((await call(ctx.app, "GET", "/api/vehicles/inconnu", alice)).status, 404);
    assert.equal((await call(ctx.app, "GET", "/api/vehicles/..%2Fadmin", alice)).status, 404);
    // Aucun rapport n'a été demandé à Traccar pour le véhicule d'autrui.
    assert.ok(!ctx.traccar.requests.some((r) => r.query.getAll("deviceId").includes("2")));
  });

  it("exige une session", async () => {
    assert.equal((await call(ctx.app, "GET", `/api/vehicles/${mine}/trips?${range}`, null)).status, 401);
  });

  it("convertit les trajets en unités métriques", async () => {
    const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/trips?${range}`, alice);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.trips, [
      {
        startTime: "2026-10-27T08:00:00.000+00:00",
        endTime: "2026-10-27T08:30:00.000+00:00",
        durationMs: 1_800_000,
        distanceKm: 12.3,
        averageSpeedKmh: 37,
        maxSpeedKmh: 92.6,
        start: { latitude: 33.5, longitude: -7.6 },
        end: { latitude: 33.6, longitude: -7.5 },
      },
    ]);
    const sent = ctx.traccar.requests.find((r) => r.path === "/api/reports/trips")!;
    assert.deepEqual(sent.query.getAll("deviceId"), ["1"]);
    assert.equal(sent.query.get("from"), "2026-10-27T00:00:00.000Z");
  });

  it("donne l'adresse du premier départ et de la dernière arrivée, avec un cache", async () => {
    ctx.traccar.reports.trips.push({
      deviceId: 1,
      startTime: "2026-10-27T09:00:00.000+00:00",
      endTime: "2026-10-27T09:20:00.000+00:00",
      distance: 5_000,
      averageSpeed: 15,
      maxSpeed: 40,
      duration: 1_200_000,
      startLat: 33.6,
      startLon: -7.5,
      endLat: 33.70004,
      endLon: -7.39996,
      startAddress: null,
      endAddress: null,
    });
    ctx.traccar.addresses = { "33.7,-7.4": "Boulevard Zerktouni, Casablanca" };

    const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/trips?${range}`, alice);
    assert.equal(res.status, 200);
    assert.equal(res.json.trips.length, 2);
    // Adresse déjà fournie par Traccar pour le départ ; arrivée géocodée (coordonnées arrondies).
    assert.deepEqual(res.json.departure, { latitude: 33.5, longitude: -7.6, address: "Départ" });
    assert.deepEqual(res.json.arrival, { latitude: 33.70004, longitude: -7.39996, address: "Boulevard Zerktouni, Casablanca" });
    const geocodes = () => ctx.traccar.requests.filter((r) => r.path === "/api/server/geocode").length;
    assert.equal(geocodes(), 1);

    await call(ctx.app, "GET", `/api/vehicles/${mine}/trips?${range}`, alice);
    assert.equal(geocodes(), 1, "adresse servie par le cache");
  });

  it("renvoie les trajets sans adresse si le géocodeur n’en trouve pas", async () => {
    ctx.traccar.reports.trips[0]!.startAddress = null;
    const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/trips?${range}`, alice);
    assert.equal(res.status, 200);
    assert.equal(res.json.trips.length, 1);
    assert.equal(res.json.departure.address, null);
    assert.equal(res.json.arrival.address, null);
  });

  it("masque la distance et la vitesse moyenne d'un trajet faussé par un saut au point 0,0", async () => {
    Object.assign(ctx.traccar.reports.trips[0]!, { distance: 3_821_400, duration: 4_260_000, averageSpeed: 1734, maxSpeed: 0 });
    const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/trips?${range}`, alice);
    assert.equal(res.json.trips[0].distanceKm, null);
    assert.equal(res.json.trips[0].averageSpeedKmh, null);
    assert.equal(res.json.trips[0].durationMs, 4_260_000);
    assert.equal(res.json.trips[0].maxSpeedKmh, 0);
  });

  it("masque aussi un long trajet faussé dont la moyenne dépasse la vitesse max", async () => {
    // Cas réel : 3 796 km en 16 h 52 (225 km/h de moyenne) avec un max à 0 km/h.
    Object.assign(ctx.traccar.reports.trips[0]!, { distance: 3_796_300, duration: 60_720_000, averageSpeed: 121, maxSpeed: 0 });
    const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/trips?${range}`, alice);
    assert.equal(res.json.trips[0].distanceKm, null);
  });

  it("garde un trajet normal dont la moyenne approche la vitesse max", async () => {
    // 45 km en 30 min (90 km/h) avec un max relevé à 70 km/h : écart dans la marge du GPS.
    Object.assign(ctx.traccar.reports.trips[0]!, { distance: 45_000, duration: 1_800_000, maxSpeed: 70 / 1.852 });
    const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/trips?${range}`, alice);
    assert.equal(res.json.trips[0].distanceKm, 45);
  });

  it("ne renvoie ni départ ni arrivée sans trajet", async () => {
    ctx.traccar.reports.trips = [];
    const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/trips?${range}`, alice);
    assert.deepEqual(res.json, { trips: [], departure: null, arrival: null });
  });

  it("valide la période", async () => {
    const bad = [
      "",
      "from=hier&to=aujourdhui",
      `from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}`,
      `from=2026-09-01T00:00:00Z&to=2026-10-28T00:00:00Z`,
    ];
    for (const query of bad) {
      const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/trips?${query}`, alice);
      assert.equal(res.status, 400, query);
    }
    // Le tracé est limité à 7 jours.
    const week = await call(ctx.app, "GET", `/api/vehicles/${mine}/route?from=2026-10-01T00:00:00Z&to=2026-10-10T00:00:00Z`, alice);
    assert.equal(week.status, 400);
    // « 7 jours » qui couvre le passage à l'heure d'hiver : 7 jours et quelques minutes, accepté.
    const dst = await call(ctx.app, "GET", `/api/vehicles/${mine}/route?from=2026-10-22T22:00:00Z&to=2026-10-29T22:02:36Z`, alice);
    assert.equal(dst.status, 200);
  });

  it("renvoie le tracé sans les positions invalides", async () => {
    const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/route?${range}`, alice);
    assert.equal(res.status, 200);
    assert.equal(res.json.truncated, false);
    assert.deepEqual(
      res.json.points.map((p: { speedKmh: number }) => p.speedKmh),
      [0, 18.5],
    );
  });

  it("montre tout l'historique Traccar, même antérieur à l'affectation (limite désactivée)", async () => {
    await prisma.vehicle.update({ where: { id: mine }, data: { historyStartAt: new Date("2026-10-27T12:00:00Z") } });
    ctx.traccar.requests = [];
    assert.equal((await call(ctx.app, "GET", `/api/vehicles/${mine}/trips?${range}`, alice)).status, 200);
    assert.equal((await call(ctx.app, "GET", `/api/vehicles/${mine}/route?${range}`, alice)).status, 200);
    const sent = ctx.traccar.requests.filter((r) => r.path.startsWith("/api/reports/"));
    assert.equal(sent.length, 2);
    for (const r of sent) assert.equal(r.query.get("from"), "2026-10-27T00:00:00.000Z", r.path);
  });

  it("répond 503 sans détail interne si Traccar est en panne", async () => {
    ctx.traccar.down = true;
    const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/trips?${range}`, alice);
    assert.equal(res.status, 503);
    assert.doesNotMatch(res.body, /NullPointer|java/);
  });
});

describe("clampToAssignment (si la limite est réactivée)", () => {
  const period = { from: new Date("2026-10-27T00:00:00Z"), to: new Date("2026-10-28T00:00:00Z") };
  it("borne au début d'historique, ou ne renvoie rien si tout est antérieur", () => {
    assert.deepEqual(clampToAssignment(period, new Date("2026-10-27T12:00:00Z"), true), {
      from: new Date("2026-10-27T12:00:00Z"),
      to: period.to,
    });
    assert.equal(clampToAssignment(period, new Date("2026-10-28T00:00:00Z"), true), null);
    assert.deepEqual(clampToAssignment(period, new Date("2026-10-27T12:00:00Z"), false), period);
  });
});

describe("downsample", () => {
  it("garde au plus max points dont le dernier", () => {
    const points = Array.from({ length: 10_001 }, (_, i) => i);
    const kept = downsample(points, 2000);
    assert.ok(kept.length <= 2001);
    assert.equal(kept[0], 0);
    assert.equal(kept[kept.length - 1], 10_000);
    assert.deepEqual(downsample([1, 2, 3], 5), [1, 2, 3]);
  });
});
