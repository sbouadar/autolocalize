import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import { localParts, runScheduledPass, type ScheduledTasks } from "../src/jobs/scheduler.js";
import { recordAppEvent } from "../src/lib/events.js";
import { prisma } from "../src/lib/prisma.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

function trip(deviceId: number, distance: number, overrides: Record<string, unknown> = {}) {
  return {
    deviceId,
    startTime: "2026-11-20T08:00:00.000+00:00",
    endTime: "2026-11-20T09:00:00.000+00:00",
    distance,
    averageSpeed: 20,
    maxSpeed: 50,
    duration: 3_600_000,
    startLat: 33.5,
    startLon: -7.6,
    endLat: 33.6,
    endLon: -7.5,
    ...overrides,
  };
}

describe("M1 : fiche véhicule, compteur, réglages du client", () => {
  let tenantA: string;
  let tenantB: string;
  let alice: Record<string, string>;
  let viewer: Record<string, string>;
  let root: Record<string, string>;
  let mine: string;
  let theirs: string;

  beforeEach(async () => {
    await resetState(ctx);
    tenantA = (await createTenant("alpha")).id;
    tenantB = (await createTenant("bravo")).id;
    await createUser("alice@alpha.test", "TENANT_ADMIN", tenantA);
    await createUser("vic@alpha.test", "VIEWER", tenantA);
    await createUser("root@plateforme.test", "SUPER_ADMIN", null);
    mine = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 1, name: "A" } })).id;
    theirs = (await prisma.vehicle.create({ data: { tenantId: tenantB, traccarDeviceId: 2, name: "B" } })).id;
    ctx.traccar.devices = [device({ id: 1 }), device({ id: 2 })];
    ctx.traccar.positions = [position({ deviceId: 1 }), position({ deviceId: 2 })];
    alice = await login(ctx.app, "alice@alpha.test");
    viewer = await login(ctx.app, "vic@alpha.test");
    root = await login(ctx.app, "root@plateforme.test");
  });

  describe("PUT /vehicles/:id", () => {
    it("modifie la fiche d'un véhicule du client et la renvoie dans GET /vehicles/:id", async () => {
      const res = await call(ctx.app, "PUT", `/api/vehicles/${mine}`, alice, {
        name: "Clio 5",
        plate: "12345-A-6",
        brand: "Renault",
        model: "Clio",
        year: 2022,
        vin: "VF1RJA00012345678",
        fuelType: "DIESEL",
        color: "Blanc",
        notes: "Rayure aile gauche",
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.vehicle.details.brand, "Renault");

      const read = await call(ctx.app, "GET", `/api/vehicles/${mine}`, alice);
      assert.equal(read.json.vehicle.name, "Clio 5");
      assert.deepEqual(read.json.vehicle.details, {
        brand: "Renault",
        model: "Clio",
        year: 2022,
        vin: "VF1RJA00012345678",
        fuelType: "DIESEL",
        color: "Blanc",
        notes: "Rayure aile gauche",
      });
      // Journal sans le texte libre des notes.
      const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "vehicle.details.update" } });
      assert.ok(!log.details!.includes("Rayure"));
    });

    it("efface un champ avec une chaîne vide et refuse les valeurs invalides ou non prévues", async () => {
      await call(ctx.app, "PUT", `/api/vehicles/${mine}`, alice, { brand: "Renault" });
      assert.equal((await call(ctx.app, "PUT", `/api/vehicles/${mine}`, alice, { brand: "" })).status, 200);
      assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: mine } })).brand, null);

      for (const body of [{ year: 1800 }, { fuelType: "KEROSENE" }, { vin: "!!" }, { tenantId: tenantB }, { name: "" }, { historyStartAt: "2020-01-01T00:00:00Z" }]) {
        assert.equal((await call(ctx.app, "PUT", `/api/vehicles/${mine}`, alice, body)).status, 400, JSON.stringify(body));
      }
    });

    it("est réservé à l'admin du client et traite le véhicule d'un autre client comme inexistant", async () => {
      assert.equal((await call(ctx.app, "PUT", `/api/vehicles/${mine}`, viewer, { brand: "X" })).status, 403);
      assert.equal((await call(ctx.app, "PUT", `/api/vehicles/${mine}`, root, { brand: "X" })).status, 403);
      assert.equal((await call(ctx.app, "PUT", `/api/vehicles/${theirs}`, alice, { brand: "X" })).status, 404);
      assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: theirs } })).brand, null);
    });
  });

  describe("Compteur kilométrique", () => {
    it("sans relevé, ne donne pas d'estimation", async () => {
      const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/odometer`, viewer);
      assert.equal(res.status, 200);
      assert.equal(res.json.lastReading, null);
      assert.equal(res.json.estimatedKm, null);
      assert.deepEqual(res.json.readings, []);
    });

    it("estime le compteur : dernier relevé + distance GPS des trajets depuis", async () => {
      const readAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
      const created = await call(ctx.app, "POST", `/api/vehicles/${mine}/odometer`, alice, { km: 45_000, readAt });
      assert.equal(created.status, 201);
      ctx.traccar.reports.trips = [trip(1, 12_400), trip(1, 30_600), trip(2, 999_000)];

      const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/odometer`, viewer);
      assert.equal(res.status, 200);
      assert.equal(res.json.lastReading.km, 45_000);
      assert.equal(res.json.gpsKmSinceReading, 43);
      assert.equal(res.json.estimatedKm, 45_043);
      assert.equal(res.json.partial, false);
      // Les trajets sont demandés depuis la date du relevé, pour ce traceur seulement.
      const req = ctx.traccar.requests.find((r) => r.path === "/api/reports/trips")!;
      assert.equal(req.query.get("from"), readAt);
      assert.deepEqual(req.query.getAll("deviceId"), ["1"]);
    });

    it("donne le dernier relevé même si Traccar est indisponible", async () => {
      await call(ctx.app, "POST", `/api/vehicles/${mine}/odometer`, alice, { km: 1000 });
      ctx.traccar.down = true;
      const res = await call(ctx.app, "GET", `/api/vehicles/${mine}/odometer`, alice);
      assert.equal(res.status, 200);
      assert.equal(res.json.lastReading.km, 1000);
      assert.equal(res.json.estimatedKm, null);
      assert.equal(res.json.unavailableReason, "TRACCAR_UNAVAILABLE");
    });

    it("refuse un compteur qui recule, une date future et un relevé d'un autre client", async () => {
      const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/odometer`, alice, { km: 50_000, readAt: day(5) })).status, 201);
      const lower = await call(ctx.app, "POST", `/api/vehicles/${mine}/odometer`, alice, { km: 49_000, readAt: day(1) });
      assert.equal(lower.status, 409);
      assert.equal(lower.json.code, "ODOMETER_DECREASE");
      // Plus élevé qu'un relevé plus récent : refusé aussi.
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/odometer`, alice, { km: 60_000, readAt: day(1) })).status, 201);
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/odometer`, alice, { km: 70_000, readAt: day(3) })).status, 409);

      const future = new Date(Date.now() + 86_400_000).toISOString();
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/odometer`, alice, { km: 80_000, readAt: future })).status, 400);
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/odometer`, alice, { km: -1 })).status, 400);
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${theirs}/odometer`, alice, { km: 1 })).status, 404);
      assert.equal((await call(ctx.app, "GET", `/api/vehicles/${theirs}/odometer`, alice)).status, 404);
    });

    it("réserve la saisie et la suppression à l'admin du client", async () => {
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/odometer`, viewer, { km: 10 })).status, 403);
      const created = await call(ctx.app, "POST", `/api/vehicles/${mine}/odometer`, alice, { km: 10 });
      const readingId = created.json.reading.id;
      assert.equal((await call(ctx.app, "DELETE", `/api/vehicles/${mine}/odometer/${readingId}`, viewer)).status, 403);
      // Le relevé ne se supprime que par son véhicule.
      assert.equal((await call(ctx.app, "DELETE", `/api/vehicles/${theirs}/odometer/${readingId}`, alice)).status, 404);
      assert.equal((await call(ctx.app, "DELETE", `/api/vehicles/${mine}/odometer/${readingId}`, alice)).status, 204);
      assert.equal(await prisma.odometerReading.count(), 0);
      assert.equal(await prisma.auditLog.count({ where: { action: { in: ["odometer.create", "odometer.delete"] } } }), 2);
    });
  });

  describe("Réglages du client", () => {
    it("renvoie devise, fuseau et modules dans /me, MAD et Casablanca par défaut", async () => {
      const res = await call(ctx.app, "GET", "/api/me", alice);
      assert.equal(res.json.tenant.currency, "MAD");
      assert.equal(res.json.tenant.timezone, "Africa/Casablanca");
      assert.equal(res.json.tenant.rentalsEnabled, false);
      assert.equal(res.json.tenant.driversEnabled, false);
    });

    it("se règlent par le super-admin dans le back-office, avec un fuseau valide", async () => {
      const ok = await call(ctx.app, "PUT", `/api/admin/tenants/${tenantA}`, root, {
        currency: "EUR",
        timezone: "Europe/Paris",
        rentalsEnabled: true,
      });
      assert.equal(ok.status, 200);
      assert.equal((await call(ctx.app, "GET", "/api/me", alice)).json.tenant.currency, "EUR");
      assert.equal((await call(ctx.app, "PUT", `/api/admin/tenants/${tenantA}`, root, { timezone: "Mars/Olympus" })).status, 400);
      assert.equal((await call(ctx.app, "PUT", `/api/admin/tenants/${tenantA}`, root, { currency: "GBP" })).status, 400);
      // L'admin du client ne change pas lui-même ses modules par son branding.
      assert.equal((await call(ctx.app, "PUT", "/api/tenant/branding", alice, { rentalsEnabled: true })).status, 400);
    });
  });
});

describe("M1 : événements de l'API et tâche planifiée", () => {
  const log = { error: () => {}, warn: () => {}, info: () => {} } as unknown as FastifyBaseLogger;

  beforeEach(async () => {
    await resetState(ctx);
  });

  it("n'enregistre une alerte de l'API qu'une fois par clé, et la liste dans les alertes", async () => {
    const tenant = await createTenant("alpha");
    await createUser("alice@alpha.test", "TENANT_ADMIN", tenant.id);
    const input = {
      tenantId: tenant.id,
      vehicleId: null,
      vehicleName: "A",
      type: "DOCUMENT_EXPIRING" as const,
      eventTime: new Date(),
      dedupKey: "deadline:x:2026-12-31:J-30",
      message: "Assurance : expire le 31/12/2026",
    };
    assert.equal(await recordAppEvent(input), "stored");
    assert.equal(await recordAppEvent(input), "duplicate");
    assert.equal(await prisma.event.count(), 1);

    const alice = await login(ctx.app, "alice@alpha.test");
    const res = await call(ctx.app, "GET", "/api/alerts", alice);
    assert.equal(res.json.alerts.length, 1);
    assert.equal(res.json.alerts[0].message, "Assurance : expire le 31/12/2026");
  });

  it("lance les tâches quotidiennes une fois par jour et par client, à partir de 7 h dans son fuseau", async () => {
    // Fuseaux aux décalages stables en novembre : Paris UTC+1, Tokyo UTC+9.
    const paris = await createTenant("paris");
    await prisma.tenant.update({ where: { id: paris.id }, data: { timezone: "Europe/Paris" } });
    const tokyo = await createTenant("tokyo");
    await prisma.tenant.update({ where: { id: tokyo.id }, data: { timezone: "Asia/Tokyo" } });
    await createTenant("suspendu", { status: "SUSPENDED" });

    const calls: string[] = [];
    let frequent = 0;
    const registry: ScheduledTasks = {
      frequent: [async () => void frequent++],
      daily: [async ({ tenant, localDate }) => void calls.push(`${tenant.timezone}:${localDate}`)],
    };

    // 05:30 UTC : 06:30 à Paris (trop tôt), 14:30 à Tokyo.
    await runScheduledPass(new Date("2026-11-21T05:30:00Z"), log, registry);
    assert.deepEqual(calls, ["Asia/Tokyo:2026-11-21"]);
    // 06:10 UTC : 07:10 à Paris ; Tokyo a déjà eu sa journée. Le client suspendu n'a rien.
    await runScheduledPass(new Date("2026-11-21T06:10:00Z"), log, registry);
    assert.deepEqual(calls, ["Asia/Tokyo:2026-11-21", "Europe/Paris:2026-11-21"]);
    // Plus tard le même jour : rien de plus.
    await runScheduledPass(new Date("2026-11-21T12:00:00Z"), log, registry);
    assert.equal(calls.length, 2);
    // Le lendemain : de nouveau.
    await runScheduledPass(new Date("2026-11-22T06:10:00Z"), log, registry);
    assert.equal(calls.length, 4);
    assert.equal(frequent, 4);
  });

  it("retente la journée d'un client si une tâche quotidienne a échoué", async () => {
    const paris = await createTenant("paris");
    await prisma.tenant.update({ where: { id: paris.id }, data: { timezone: "Europe/Paris" } });
    let attempts = 0;
    const registry: ScheduledTasks = {
      frequent: [],
      daily: [
        async () => {
          attempts++;
          if (attempts === 1) throw new Error("panne");
        },
      ],
    };
    await runScheduledPass(new Date("2026-11-21T08:00:00Z"), log, registry);
    await runScheduledPass(new Date("2026-11-21T08:05:00Z"), log, registry);
    await runScheduledPass(new Date("2026-11-21T08:10:00Z"), log, registry);
    assert.equal(attempts, 2);
  });

  it("calcule la date et l'heure locales d'un fuseau", () => {
    assert.deepEqual(localParts(new Date("2026-11-21T23:30:00Z"), "Asia/Tokyo"), { date: "2026-11-22", hour: 8 });
    assert.deepEqual(localParts(new Date("2026-11-21T23:30:00Z"), "America/New_York"), { date: "2026-11-21", hour: 18 });
  });
});
