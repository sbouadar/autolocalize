import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { centsToString, toCents, zonedDayStart } from "../src/lib/expenses.js";
import { prisma } from "../src/lib/prisma.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe("M7 : dépenses et rentabilité", () => {
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
    await prisma.tenant.updateMany({ data: { timezone: "Europe/Paris" } });
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

  const add = (body: Record<string, unknown>, headers = alice) =>
    call(ctx.app, "POST", "/api/expenses", headers, { vehicleId: car, spentOn: day(-1), category: "TOLL", amount: 25, ...body });

  describe("calculs", () => {
    it("compte en centimes sans perte et convertit les jours locaux en instants", () => {
      assert.equal(toCents("0.10") + toCents("0.20"), 30);
      assert.equal(centsToString(123456), "1234.56");
      assert.equal(centsToString(-5), "-0.05");
      // Paris : UTC+1 en hiver, UTC+2 en été ; Casablanca en UTC+1 le 2026-01-15.
      assert.equal(zonedDayStart("2026-01-15", "Europe/Paris").toISOString(), "2026-01-14T23:00:00.000Z");
      assert.equal(zonedDayStart("2026-07-15", "Europe/Paris").toISOString(), "2026-07-14T22:00:00.000Z");
      assert.equal(zonedDayStart("2026-01-15", "Asia/Tokyo").toISOString(), "2026-01-14T15:00:00.000Z");
    });
  });

  describe("Dépenses", () => {
    it("enregistre une dépense, la liste avec son total, et la modifie", async () => {
      const fuel = await add({ category: "FUEL", amount: 450.5, liters: 35.2, km: 45_000, notes: "Plein" }, agent);
      assert.equal(fuel.status, 201);
      assert.deepEqual(
        [fuel.json.expense.category, fuel.json.expense.amount, fuel.json.expense.liters, fuel.json.expense.vehicleName, fuel.json.expense.spentOn],
        ["FUEL", "450.50", 35.2, "Clio", day(-1)],
      );
      await add({ vehicleId: van, amount: 10.25, spentOn: day(-40) });
      const list = await call(ctx.app, "GET", "/api/expenses", viewer);
      assert.equal(list.status, 200);
      assert.deepEqual(list.json.expenses.map((e: { amount: string }) => e.amount), ["450.50", "10.25"]);
      assert.equal(list.json.total, "460.75");
      const recent = await call(ctx.app, "GET", `/api/expenses?from=${day(-7)}&vehicleId=${car}`, viewer);
      assert.equal(recent.json.count, 1);
      assert.equal((await call(ctx.app, "GET", "/api/expenses?category=TOLL", viewer)).json.total, "10.25");

      const id = fuel.json.expense.id;
      // Passée en « péage » : le litrage est effacé.
      const updated = await call(ctx.app, "PUT", `/api/expenses/${id}`, alice, { category: "TOLL", amount: 30 });
      assert.deepEqual([updated.json.expense.category, updated.json.expense.amount, updated.json.expense.liters], ["TOLL", "30.00", null]);
      assert.equal((await call(ctx.app, "PUT", `/api/expenses/${id}`, agent, { amount: 1 })).status, 403);
      assert.equal((await call(ctx.app, "DELETE", `/api/expenses/${id}`, agent)).status, 403);
      assert.equal((await call(ctx.app, "DELETE", `/api/expenses/${id}`, alice)).status, 204);
      const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);
      assert.deepEqual(actions.filter((a) => a.startsWith("expense.")), ["expense.create", "expense.create", "expense.update", "expense.delete"]);
    });

    it("valide les saisies", async () => {
      for (const body of [
        { amount: 0 },
        { amount: -3 },
        { amount: 10.123 },
        { category: "TOLL", liters: 20 },
        { spentOn: day(5) },
        { spentOn: "2026-02-30" },
        { category: "PIZZA" },
        { vehicleId: theirs },
        { vehicleId: "inconnu" },
        { createdBy: "x" },
      ]) {
        assert.equal((await add(body)).status, 400, JSON.stringify(body));
      }
    });

    it("réserve la saisie à l'admin et aux agents, et cloisonne les clients", async () => {
      assert.equal((await add({}, viewer)).status, 403);
      const id = (await add({})).json.expense.id;
      assert.equal((await call(ctx.app, "GET", "/api/expenses", bob)).json.expenses.length, 0);
      assert.equal((await call(ctx.app, "PUT", `/api/expenses/${id}`, bob, { amount: 1 })).status, 404);
      assert.equal((await call(ctx.app, "DELETE", `/api/expenses/${id}`, bob)).status, 404);
      assert.equal((await call(ctx.app, "GET", "/api/expenses", {})).status, 401);
    });
  });

  describe("Coût d'un entretien", () => {
    it("enregistre le coût comme une dépense liée, supprimée avec l'entretien", async () => {
      const res = await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, agent, {
        type: "OIL_CHANGE",
        doneOn: day(-2),
        km: 45_000,
        garage: "Garage du port",
        cost: 380,
      });
      assert.equal(res.status, 201);
      assert.equal(res.json.record.cost, "380.00");
      const expense = await prisma.expense.findFirstOrThrow();
      assert.deepEqual([expense.category, expense.amount.toFixed(2), expense.km, expense.notes], ["MAINTENANCE", "380.00", 45_000, "Garage du port"]);
      const records = await call(ctx.app, "GET", `/api/vehicles/${car}/maintenance-records`, viewer);
      assert.equal(records.json.records[0].cost, "380.00");
      // Sans coût : pas de dépense.
      const free = await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, alice, { type: "TIRES", doneOn: day(-1) });
      assert.equal(free.json.record.cost, null);
      assert.equal(await prisma.expense.count(), 1);
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, alice, { type: "TIRES", doneOn: day(-1), cost: -1 })).status, 400);

      assert.equal((await call(ctx.app, "DELETE", `/api/maintenance-records/${res.json.record.id}`, alice)).status, 204);
      assert.equal(await prisma.expense.count(), 0);
    });
  });

  describe("Rentabilité", () => {
    it("calcule recettes, dépenses, marge, coût au km et consommation par véhicule", async () => {
      await prisma.tenant.update({ where: { id: tenantA }, data: { rentalsEnabled: true } });
      const customer = await prisma.customer.create({ data: { tenantId: tenantA, name: "Karim" } });
      const rental = (vehicleId: string, price: string, returnedDaysAgo: number) =>
        prisma.rental.create({
          data: {
            tenantId: tenantA,
            vehicleId,
            vehicleName: "x",
            customerId: customer.id,
            status: "COMPLETED",
            startAt: new Date(Date.now() - (returnedDaysAgo + 2) * 86_400_000),
            endAt: new Date(Date.now() - returnedDaysAgo * 86_400_000),
            returnedAt: new Date(Date.now() - returnedDaysAgo * 86_400_000),
            price,
            createdBy: "x",
          },
        });
      await rental(car, "1200.50", 3);
      await rental(car, "300.00", 60); // hors période
      await prisma.rental.create({
        data: { tenantId: tenantA, vehicleId: van, vehicleName: "x", customerId: customer.id, status: "ONGOING", startAt: new Date(), endAt: new Date(Date.now() + 86_400_000), price: "999", createdBy: "x" },
      });
      await add({ category: "FUEL", amount: 400, liters: 40, spentOn: day(-5) });
      await add({ category: "TOLL", amount: 20.25, spentOn: day(-4) });
      await add({ vehicleId: van, category: "REPAIR", amount: 2000, spentOn: day(-2) });
      await add({ vehicleId: van, category: "REPAIR", amount: 50, spentOn: day(-90) }); // hors période
      await call(ctx.app, "POST", "/api/expenses", bob, { vehicleId: theirs, spentOn: day(-1), category: "TOLL", amount: 5 });
      ctx.traccar.reports.trips = [
        { deviceId: 1, startTime: new Date(Date.now() - 4 * 86_400_000).toISOString(), endTime: new Date(Date.now() - 4 * 86_400_000 + 3_600_000).toISOString(), distance: 500_000, averageSpeed: 40, maxSpeed: 60, duration: 3_600_000 * 8, startLat: 33.5, startLon: -7.6, endLat: 34, endLon: -6.8 },
      ];

      const res = await call(ctx.app, "GET", `/api/reports/profitability?from=${day(-29)}&to=${day(0)}`, viewer);
      assert.equal(res.status, 200);
      const r = res.json;
      assert.deepEqual(r.totals, { revenue: "1200.50", expenses: "2420.25", margin: "-1219.75", distanceKm: 500, costPerKm: "4.84", fuelLiters: 40 });
      assert.deepEqual(r.byCategory, [
        { category: "REPAIR", amount: "2000.00" },
        { category: "FUEL", amount: "400.00" },
        { category: "TOLL", amount: "20.25" },
      ]);
      assert.equal(r.currency, "MAD");
      assert.equal(r.distanceAvailable, true);
      const [clio, master] = r.vehicles;
      assert.deepEqual(
        [clio.name, clio.rentalCount, clio.revenue, clio.expenses, clio.margin, clio.distanceKm, clio.costPerKm, clio.consumptionL100],
        ["Clio", 1, "1200.50", "420.25", "780.25", 500, "0.84", 8],
      );
      assert.deepEqual([master.name, master.margin, master.distanceKm, master.costPerKm], ["Master", "-2000.00", 0, null]);
    });

    it("rend la rentabilité sans distances si Traccar est indisponible", async () => {
      await add({});
      ctx.traccar.down = true;
      const r = (await call(ctx.app, "GET", `/api/reports/profitability?from=${day(-6)}&to=${day(0)}`, alice)).json;
      assert.equal(r.distanceAvailable, false);
      assert.equal(r.totals.distanceKm, null);
      assert.equal(r.totals.expenses, "25.00");
    });

    it("valide la période et réserve le rapport à l'admin et aux comptes en consultation", async () => {
      assert.equal((await call(ctx.app, "GET", `/api/reports/profitability?from=${day(0)}&to=${day(-3)}`, alice)).status, 400);
      assert.equal((await call(ctx.app, "GET", `/api/reports/profitability?from=${day(-400)}&to=${day(0)}`, alice)).status, 400);
      assert.equal((await call(ctx.app, "GET", `/api/reports/profitability?from=x&to=${day(0)}`, alice)).status, 400);
      assert.equal((await call(ctx.app, "GET", `/api/reports/profitability?from=${day(-3)}&to=${day(0)}`, agent)).status, 403);
    });
  });
});
