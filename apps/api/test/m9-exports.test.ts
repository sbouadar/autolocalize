import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { csvCell, toCsv } from "../src/lib/csv.js";
import { prisma } from "../src/lib/prisma.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
/** Lignes du CSV sans le BOM, cellules séparées. */
const parse = (body: string) =>
  body
    .replace(/^﻿/, "")
    .trimEnd()
    .split("\r\n")
    .map((line) => line.split(";"));

describe("M9 : exports CSV", () => {
  let tenantA: string;
  let alice: Record<string, string>;
  let agent: Record<string, string>;
  let viewer: Record<string, string>;
  let bob: Record<string, string>;
  let car: string;
  let theirs: string;

  beforeEach(async () => {
    await resetState(ctx);
    tenantA = (await createTenant("alpha")).id;
    const b = await createTenant("bravo");
    await prisma.tenant.updateMany({ data: { timezone: "Europe/Paris" } });
    await createUser("alice@alpha.test", "TENANT_ADMIN", tenantA);
    await createUser("ali@alpha.test", "AGENT", tenantA);
    await createUser("vic@alpha.test", "VIEWER", tenantA);
    await createUser("bob@bravo.test", "TENANT_ADMIN", b.id);
    car = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 1, name: "Clio", plate: "1-A-1" } })).id;
    theirs = (await prisma.vehicle.create({ data: { tenantId: b.id, traccarDeviceId: 2, name: "B" } })).id;
    ctx.traccar.devices = [device({ id: 1 }), device({ id: 2 })];
    ctx.traccar.positions = [position({ deviceId: 1 })];
    alice = await login(ctx.app, "alice@alpha.test");
    agent = await login(ctx.app, "ali@alpha.test");
    viewer = await login(ctx.app, "vic@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
  });

  it("écrit des cellules lisibles par Excel en français et neutralise les formules", () => {
    assert.equal(csvCell(12.5), "12,5");
    assert.equal(csvCell("a;b"), '"a;b"');
    assert.equal(csvCell('dit "oui"'), '"dit ""oui"""');
    assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
    assert.equal(csvCell("+212600"), "'+212600");
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvCell(-3), "-3");
    assert.equal(csvCell(null), "");
    assert.ok(toCsv(["A"], [["b"]]).startsWith("﻿A\r\nb"));
  });

  it("exporte les dépenses et les entretiens de la période", async () => {
    await call(ctx.app, "POST", "/api/expenses", alice, { vehicleId: car, spentOn: day(-2), category: "FUEL", amount: 450.5, liters: 35.2, notes: "=1+1" });
    await call(ctx.app, "POST", "/api/expenses", alice, { vehicleId: car, spentOn: day(-60), category: "TOLL", amount: 10 });
    await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, alice, { type: "OIL_CHANGE", doneOn: day(-1), km: 45_000, garage: "Garage; du port", cost: 380 });

    const res = await call(ctx.app, "GET", `/api/exports/expenses.csv?from=${day(-30)}&to=${day(0)}`, viewer);
    assert.equal(res.status, 200);
    assert.match(String(res.headers["content-type"]), /^text\/csv; charset=utf-8/);
    assert.match(String(res.headers["content-disposition"]), /^attachment; filename="depenses-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv"$/);
    assert.equal(res.headers["cache-control"], "private, no-store");
    assert.ok(res.body.startsWith("﻿"));
    const rows = parse(res.body);
    assert.deepEqual(rows[0], ["Date", "Véhicule", "Plaque", "Catégorie", "Montant", "Devise", "Litres", "Compteur (km)", "Notes"]);
    // Le coût de l'entretien est aussi une dépense ; la note « =1+1 » est neutralisée.
    assert.equal(rows.length, 3);
    assert.deepEqual([rows[1]![3], rows[1]![4], rows[1]![6], rows[1]![8]], ["Carburant", "450,5", "35,2", "'=1+1"]);
    assert.deepEqual([rows[2]![3], rows[2]![4]], ["Entretien", "380"]);
    assert.match(res.body, /;"Garage; du port"\r\n$/);

    const maintenance = parse((await call(ctx.app, "GET", `/api/exports/maintenance.csv?from=${day(-30)}&to=${day(0)}`, alice)).body);
    assert.equal(maintenance.length, 2);
    assert.deepEqual(maintenance[1]!.slice(3, 5), ["Vidange", "45000"]);
    assert.match(maintenance.slice(1)[0]!.join(";"), /"Garage; du port";380;MAD/);
    assert.equal((await prisma.auditLog.count({ where: { action: "export.download" } })), 2);
  });

  it("exporte les trajets avec le conducteur, sur 31 jours au plus", async () => {
    await prisma.tenant.update({ where: { id: tenantA }, data: { driversEnabled: true } });
    const driver = (await call(ctx.app, "POST", "/api/drivers", alice, { name: "Yassine" })).json.driver.id;
    await call(ctx.app, "POST", `/api/vehicles/${car}/driver`, alice, { driverId: driver, at: at(-10) });
    ctx.traccar.reports.trips = [
      { deviceId: 1, startTime: at(-8), endTime: at(-7), distance: 40_000, averageSpeed: 20, maxSpeed: 60, duration: 3_600_000, startLat: 33.5, startLon: -7.6, endLat: 33.6, endLon: -7.5 },
    ];
    const rows = parse((await call(ctx.app, "GET", `/api/exports/trips.csv?from=${day(-2)}&to=${day(0)}`, viewer)).body);
    assert.deepEqual(rows[0]!.slice(0, 3), ["Véhicule", "Plaque", "Conducteur"]);
    assert.deepEqual([rows[1]![0], rows[1]![1], rows[1]![2], rows[1]![5], rows[1]![6]], ["Clio", "1-A-1", "Yassine", "60", "40"]);
    assert.equal((await call(ctx.app, "GET", `/api/exports/trips.csv?from=${day(-40)}&to=${day(0)}`, viewer)).status, 400);
    ctx.traccar.down = true;
    assert.equal((await call(ctx.app, "GET", `/api/exports/trips.csv?from=${day(-2)}&to=${day(0)}`, viewer)).status, 503);
  });

  it("exporte les locations sans aucun numéro de pièce d'identité", async () => {
    await prisma.tenant.update({ where: { id: tenantA }, data: { rentalsEnabled: true } });
    const customer = (await call(ctx.app, "POST", "/api/customers", alice, { name: "Karim Alaoui", phone: "+212600000001", idDocumentType: "NATIONAL_ID", idDocumentNumber: "BK123456", licenseNumber: "LIC98765" })).json.customer.id;
    await call(ctx.app, "POST", "/api/rentals", alice, { vehicleId: car, customerId: customer, startAt: at(24), endAt: at(72), price: 1200.5, pickupLocation: "CASABLANCA AEROPORT" });
    const res = await call(ctx.app, "GET", `/api/exports/rentals.csv?from=${day(0)}&to=${day(10)}`, viewer);
    assert.equal(res.status, 200);
    assert.doesNotMatch(res.body, /BK123456|LIC98765|3456|8765/);
    const rows = parse(res.body);
    assert.deepEqual([rows[1]![1], rows[1]![2], rows[1]![4], rows[1]![5], rows[1]![11], rows[1]![17], rows[1]![19]], ["Réservée", "Clio", "Karim Alaoui", "'+212600000001", "CASABLANCA AEROPORT", "1200,5", "MAD"]);
    await prisma.tenant.update({ where: { id: tenantA }, data: { rentalsEnabled: false } });
    assert.equal((await call(ctx.app, "GET", `/api/exports/rentals.csv?from=${day(0)}&to=${day(10)}`, viewer)).status, 404);
  });

  it("réserve les exports à l'admin et aux comptes en consultation, et cloisonne les clients", async () => {
    assert.equal((await call(ctx.app, "GET", `/api/exports/expenses.csv?from=${day(-3)}&to=${day(0)}`, agent)).status, 403);
    assert.equal((await call(ctx.app, "GET", `/api/exports/expenses.csv?from=${day(-3)}&to=${day(0)}&vehicleId=${theirs}`, alice)).status, 404);
    assert.equal((await call(ctx.app, "GET", `/api/exports/expenses.csv?from=${day(0)}&to=${day(-3)}`, alice)).status, 400);
    assert.equal((await call(ctx.app, "GET", `/api/exports/expenses.csv?from=${day(-400)}&to=${day(0)}`, alice)).status, 400);
    await call(ctx.app, "POST", "/api/expenses", bob, { vehicleId: theirs, spentOn: day(-1), category: "TOLL", amount: 5 });
    assert.equal(parse((await call(ctx.app, "GET", `/api/exports/expenses.csv?from=${day(-3)}&to=${day(0)}`, alice)).body).length, 1);
  });
});
