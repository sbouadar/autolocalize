import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import { runScheduledPass, type ScheduledTasks } from "../src/jobs/scheduler.js";
import { todayIn } from "../src/lib/deadlines.js";
import { driverLicenseAlertsTask } from "../src/lib/drivers.js";
import { prisma } from "../src/lib/prisma.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const log = { error: () => {}, warn: () => {}, info: () => {} } as unknown as FastifyBaseLogger;
const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const dayOffset = (n: number) => new Date(Date.parse(`${todayIn("Europe/Paris")}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("M8 : conducteurs", () => {
  let tenantA: string;
  let alice: Record<string, string>;
  let agent: Record<string, string>;
  let viewer: Record<string, string>;
  let bob: Record<string, string>;
  let car: string;
  let van: string;
  let theirs: string;

  beforeEach(async () => {
    await resetState(ctx);
    tenantA = (await createTenant("alpha")).id;
    const b = await createTenant("bravo");
    await prisma.tenant.updateMany({ data: { driversEnabled: true, timezone: "Europe/Paris" } });
    await createUser("alice@alpha.test", "TENANT_ADMIN", tenantA);
    await createUser("ali@alpha.test", "AGENT", tenantA);
    await createUser("vic@alpha.test", "VIEWER", tenantA);
    await createUser("bob@bravo.test", "TENANT_ADMIN", b.id);
    car = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 1, name: "Clio" } })).id;
    van = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 3, name: "Master" } })).id;
    theirs = (await prisma.vehicle.create({ data: { tenantId: b.id, traccarDeviceId: 2, name: "B" } })).id;
    ctx.traccar.devices = [device({ id: 1 }), device({ id: 2 }), device({ id: 3 })];
    ctx.traccar.positions = [position({ deviceId: 1 })];
    alice = await login(ctx.app, "alice@alpha.test");
    agent = await login(ctx.app, "ali@alpha.test");
    viewer = await login(ctx.app, "vic@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
  });

  const newDriver = async (name: string, extra: Record<string, unknown> = {}) =>
    (await call(ctx.app, "POST", "/api/drivers", alice, { name, ...extra })).json.driver.id as string;
  const assign = (vehicleId: string, driverId: string | null, when?: string, headers = alice) =>
    call(ctx.app, "POST", `/api/vehicles/${vehicleId}/driver`, headers, { driverId, ...(when && { at: when }) });

  it("crée, liste, modifie et archive des conducteurs", async () => {
    const res = await call(ctx.app, "POST", "/api/drivers", alice, { name: " Yassine ", phone: "+212600000001", licenseNumber: "AB123", licenseExpiresOn: "2027-05-01" });
    assert.equal(res.status, 201);
    assert.deepEqual([res.json.driver.name, res.json.driver.licenseExpiresOn, res.json.driver.active, res.json.driver.currentVehicle], ["Yassine", "2027-05-01", true, null]);
    const id = res.json.driver.id;
    await newDriver("Amine");
    assert.deepEqual((await call(ctx.app, "GET", "/api/drivers", viewer)).json.drivers.map((d: { name: string }) => d.name), ["Amine", "Yassine"]);

    assert.equal((await call(ctx.app, "PUT", `/api/drivers/${id}`, alice, { phone: null, active: false })).json.driver.phone, null);
    assert.deepEqual((await call(ctx.app, "GET", "/api/drivers", viewer)).json.drivers.map((d: { name: string }) => d.name), ["Amine"]);
    assert.equal((await call(ctx.app, "GET", "/api/drivers?includeInactive=true", viewer)).json.drivers.length, 2);
    // Pas de numéro de permis ni de téléphone dans le journal.
    const details = JSON.stringify((await prisma.auditLog.findMany()).map((a) => a.details));
    assert.doesNotMatch(details, /AB123|600000001/);
  });

  it("valide les saisies et réserve l'écriture à l'admin", async () => {
    for (const body of [{}, { name: "" }, { name: "A", email: "pas-un-email" }, { name: "A", licenseExpiresOn: "2027-02-30" }, { name: "A", tenantId: "x" }]) {
      assert.equal((await call(ctx.app, "POST", "/api/drivers", alice, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await call(ctx.app, "POST", "/api/drivers", agent, { name: "A" })).status, 403);
    assert.equal((await call(ctx.app, "GET", "/api/drivers", agent)).status, 200);
  });

  it("affecte un conducteur, change de conducteur et garde l'historique", async () => {
    const yassine = await newDriver("Yassine");
    const amine = await newDriver("Amine");
    assert.equal((await assign(car, yassine, at(-48))).json.current.driver.name, "Yassine");
    // Amine prend la Clio : l'affectation de Yassine se termine.
    assert.equal((await assign(car, amine, at(-24))).json.current.driver.name, "Amine");
    // Amine passe sur le Master : la Clio n'a plus de conducteur.
    await assign(van, amine, at(-2));
    const clio = (await call(ctx.app, "GET", `/api/vehicles/${car}/driver`, viewer)).json;
    assert.equal(clio.current, null);
    assert.deepEqual(clio.assignments.map((a: { driver: { name: string } }) => a.driver.name), ["Amine", "Yassine"]);
    const drivers = (await call(ctx.app, "GET", "/api/drivers", viewer)).json.drivers;
    assert.deepEqual(drivers.map((d: { name: string; currentVehicle: { name: string } | null }) => [d.name, d.currentVehicle?.name ?? null]), [["Amine", "Master"], ["Yassine", null]]);
    // Réaffecter le même conducteur ne change rien.
    await assign(van, amine);
    assert.equal(await prisma.driverAssignment.count({ where: { vehicleId: van } }), 1);
    // Libérer le véhicule.
    assert.equal((await assign(van, null)).json.current, null);
    assert.equal(await prisma.driverAssignment.count({ where: { endAt: null } }), 0);
    // Un conducteur avec historique ne se supprime pas : il s'archive.
    assert.equal((await call(ctx.app, "DELETE", `/api/drivers/${amine}`, alice)).json.code, "DRIVER_HAS_HISTORY");
    const fresh = await newDriver("Nouveau");
    assert.equal((await call(ctx.app, "DELETE", `/api/drivers/${fresh}`, alice)).status, 204);
  });

  it("refuse une date incohérente, un conducteur archivé, d'un autre client, et l'écriture hors admin", async () => {
    const yassine = await newDriver("Yassine");
    await assign(car, yassine, at(-24));
    assert.equal((await assign(car, null, at(-30))).status, 400);
    assert.equal((await assign(car, null, at(5))).status, 400);
    const archived = await newDriver("Ancien", { active: false });
    assert.equal((await assign(van, archived)).status, 400);
    const other = (await call(ctx.app, "POST", "/api/drivers", bob, { name: "Autre" })).json.driver.id;
    assert.equal((await assign(van, other)).status, 400);
    assert.equal((await assign(theirs, yassine)).status, 404);
    assert.equal((await assign(van, yassine, undefined, agent)).status, 403);
    assert.equal((await call(ctx.app, "GET", `/api/drivers/${yassine}`, bob)).status, 404);
    // Archiver un conducteur termine son affectation en cours.
    await call(ctx.app, "PUT", `/api/drivers/${yassine}`, alice, { active: false });
    assert.equal(await prisma.driverAssignment.count({ where: { endAt: null } }), 0);
  });

  it("attribue trajets et alertes au conducteur affecté à ce moment", async () => {
    const yassine = await newDriver("Yassine");
    const amine = await newDriver("Amine");
    await assign(car, yassine, at(-10));
    await assign(car, amine, at(-5));
    ctx.traccar.reports.trips = [
      { deviceId: 1, startTime: at(-8), endTime: at(-7), distance: 40_000, averageSpeed: 20, maxSpeed: 60, duration: 3_600_000, startLat: 33.5, startLon: -7.6, endLat: 33.6, endLon: -7.5 },
      { deviceId: 1, startTime: at(-3), endTime: at(-2), distance: 10_000, averageSpeed: 10, maxSpeed: 30, duration: 3_600_000, startLat: 33.6, startLon: -7.5, endLat: 33.5, endLon: -7.6 },
    ];
    await prisma.event.createMany({
      data: [
        { tenantId: tenantA, vehicleId: car, vehicleName: "Clio", type: "OVERSPEED", eventTime: new Date(at(-7.5)), source: "APP", dedupKey: "a" },
        { tenantId: tenantA, vehicleId: car, vehicleName: "Clio", type: "OVERSPEED", eventTime: new Date(at(-2.5)), source: "APP", dedupKey: "b" },
      ],
    });

    const trips = (await call(ctx.app, "GET", `/api/vehicles/${car}/trips?from=${encodeURIComponent(at(-12))}&to=${encodeURIComponent(at(0))}`, viewer)).json.trips;
    assert.deepEqual(trips.map((t: { driverName: string }) => t.driverName), ["Yassine", "Amine"]);
    const alerts = (await call(ctx.app, "GET", "/api/alerts", viewer)).json.alerts;
    assert.deepEqual(alerts.map((a: { driverName: string }) => a.driverName), ["Amine", "Yassine"]);

    const activity = (await call(ctx.app, "GET", `/api/drivers/${yassine}/activity?from=${encodeURIComponent(at(-24))}&to=${encodeURIComponent(at(0))}`, viewer)).json;
    assert.deepEqual([activity.trips, activity.distanceKm, activity.drivingMs, activity.alerts], [1, 40, 3_600_000, { OVERSPEED: 1 }]);
    assert.equal(activity.segments[0].vehicleName, "Clio");
    assert.equal((await call(ctx.app, "GET", `/api/drivers/${yassine}/activity?from=${encodeURIComponent(at(-24 * 40))}&to=${encodeURIComponent(at(0))}`, viewer)).status, 400);
  });

  it("ne rattache aucun conducteur quand le module est désactivé, et répond 404 à ses routes", async () => {
    const yassine = await newDriver("Yassine");
    await assign(car, yassine, at(-10));
    await prisma.tenant.update({ where: { id: tenantA }, data: { driversEnabled: false } });
    ctx.traccar.reports.trips = [
      { deviceId: 1, startTime: at(-8), endTime: at(-7), distance: 40_000, averageSpeed: 20, maxSpeed: 60, duration: 3_600_000, startLat: 33.5, startLon: -7.6, endLat: 33.6, endLon: -7.5 },
    ];
    const trips = (await call(ctx.app, "GET", `/api/vehicles/${car}/trips?from=${encodeURIComponent(at(-12))}&to=${encodeURIComponent(at(0))}`, viewer)).json.trips;
    assert.equal("driverName" in trips[0], false);
    for (const [method, path] of [["GET", "/api/drivers"], ["POST", "/api/drivers"], ["GET", `/api/vehicles/${car}/driver`], ["POST", `/api/vehicles/${car}/driver`]] as const) {
      assert.equal((await call(ctx.app, method, path, alice, method === "POST" ? { name: "X" } : undefined)).status, 404, path);
    }
  });

  it("alerte avant l'expiration du permis, puis à l'expiration", async () => {
    const id = await newDriver("Yassine", { licenseExpiresOn: dayOffset(20) });
    await newDriver("Loin", { licenseExpiresOn: dayOffset(200) });
    await assign(car, id);
    const registry: ScheduledTasks = { frequent: [], daily: [driverLicenseAlertsTask] };
    const noon = (offset: number) => new Date(Date.parse(`${dayOffset(offset)}T12:00:00Z`));
    await runScheduledPass(noon(0), log, registry);
    await runScheduledPass(noon(1), log, registry);
    let events = await prisma.event.findMany({ orderBy: { createdAt: "asc" } });
    assert.deepEqual(events.map((e) => [e.type, e.vehicleId, e.vehicleName]), [["DRIVER_LICENSE_EXPIRING", car, "Yassine"]]);
    assert.match(events[0]!.message!, /^Permis de Yassine : expire le \d{2}\/\d{2}\/\d{4} \(dans 20 jours\)$/);
    await runScheduledPass(noon(21), log, registry);
    events = await prisma.event.findMany({ orderBy: { createdAt: "asc" } });
    assert.deepEqual(events.map((e) => e.type), ["DRIVER_LICENSE_EXPIRING", "DRIVER_LICENSE_EXPIRED"]);
    assert.equal((await call(ctx.app, "GET", "/api/alerts", viewer)).json.alerts.length, 2);
  });
});
