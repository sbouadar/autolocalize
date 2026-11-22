import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import { runScheduledPass, type ScheduledTasks } from "../src/jobs/scheduler.js";
import { todayIn } from "../src/lib/deadlines.js";
import { maintenanceAlertsTask, planDue, type PlanInput } from "../src/lib/maintenance.js";
import { prisma } from "../src/lib/prisma.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const log = { error: () => {}, warn: () => {}, info: () => {} } as unknown as FastifyBaseLogger;
const today = () => todayIn("Europe/Paris");
const dayOffset = (n: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("M4 : entretien", () => {
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
    car = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 1, name: "Clio" } })).id;
    theirs = (await prisma.vehicle.create({ data: { tenantId: b.id, traccarDeviceId: 2, name: "B" } })).id;
    ctx.traccar.devices = [device({ id: 1 }), device({ id: 2 })];
    ctx.traccar.positions = [position({ deviceId: 1 })];
    alice = await login(ctx.app, "alice@alpha.test");
    agent = await login(ctx.app, "ali@alpha.test");
    viewer = await login(ctx.app, "vic@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
  });

  const newPlan = (body: Record<string, unknown>, headers = alice) => call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-plans`, headers, body);

  describe("planDue", () => {
    const base: PlanInput = { intervalKm: 10_000, intervalDays: null, lastDoneAt: null, lastDoneKm: 40_000, warnBeforeKm: 1000, warnBeforeDays: 15, createdAt: new Date("2026-01-01T00:00:00Z") };

    it("suit le kilométrage : OK, à prévoir, en retard", () => {
      assert.deepEqual(planDue(base, 45_000, "2026-11-23"), { status: "OK", nextKm: 50_000, kmLeft: 5000, nextDate: null, daysLeft: null });
      assert.equal(planDue(base, 49_000, "2026-11-23").status, "DUE");
      assert.equal(planDue(base, 50_001, "2026-11-23").status, "OVERDUE");
      // Compteur inconnu, ou jamais d'entretien de référence : on ne peut rien dire.
      assert.equal(planDue(base, null, "2026-11-23").status, "UNKNOWN");
      assert.equal(planDue({ ...base, lastDoneKm: null }, 45_000, "2026-11-23").status, "UNKNOWN");
    });

    it("suit la date, depuis le dernier entretien ou la création du plan", () => {
      const byDate = { ...base, intervalKm: null, intervalDays: 365, lastDoneAt: new Date("2026-01-10T00:00:00Z") };
      assert.deepEqual(planDue(byDate, null, "2026-11-23"), { status: "OK", nextKm: null, kmLeft: null, nextDate: "2027-01-10", daysLeft: 48 });
      assert.equal(planDue(byDate, null, "2026-12-30").status, "DUE");
      assert.equal(planDue(byDate, null, "2027-01-11").status, "OVERDUE");
      assert.equal(planDue({ ...byDate, lastDoneAt: null }, null, "2026-11-23").nextDate, "2027-01-01");
    });

    it("retient la plus proche des deux échéances", () => {
      const both = { ...base, intervalDays: 365, lastDoneAt: new Date("2026-01-10T00:00:00Z") };
      assert.equal(planDue(both, 41_000, "2027-02-01").status, "OVERDUE"); // date dépassée, kilométrage loin
      assert.equal(planDue(both, 49_500, "2026-03-01").status, "DUE"); // kilométrage proche, date loin
    });
  });

  describe("Plans", () => {
    it("crée un plan et calcule son échéance avec le compteur estimé du véhicule", async () => {
      await call(ctx.app, "POST", `/api/vehicles/${car}/odometer`, alice, { km: 48_000, readAt: new Date(Date.now() - 86_400_000).toISOString() });
      ctx.traccar.reports.trips = [{ deviceId: 1, startTime: "x", endTime: "x", distance: 1_300_000, averageSpeed: 20, maxSpeed: 50, duration: 3_600_000 * 20, startLat: 33.5, startLon: -7.6, endLat: 33.6, endLon: -7.5 }];
      const res = await newPlan({ type: "OIL_CHANGE", intervalKm: 10_000, lastDoneKm: 40_000, lastDoneAt: dayOffset(-200) });
      assert.equal(res.status, 201);
      const p = res.json.plan;
      assert.deepEqual([p.currentKm, p.nextKm, p.kmLeft, p.status], [49_300, 50_000, 700, "DUE"]);

      await newPlan({ type: "SERVICE", intervalDays: 365, lastDoneAt: dayOffset(-10) });
      const list = await call(ctx.app, "GET", `/api/vehicles/${car}/maintenance-plans`, viewer);
      assert.deepEqual(list.json.plans.map((x: { type: string; status: string }) => [x.type, x.status]), [["OIL_CHANGE", "DUE"], ["SERVICE", "OK"]]);
      const due = await call(ctx.app, "GET", "/api/maintenance/due", viewer);
      assert.deepEqual(due.json.plans.map((x: { type: string }) => x.type), ["OIL_CHANGE"]);
      assert.deepEqual((await call(ctx.app, "GET", "/api/maintenance/due", bob)).json.plans, []);
    });

    it("exige un intervalle, un nom pour « autre », et des valeurs plausibles", async () => {
      for (const body of [
        { type: "OIL_CHANGE" },
        { type: "OTHER", intervalDays: 30 },
        { type: "OIL_CHANGE", intervalKm: 10 },
        { type: "PLEIN", intervalKm: 10_000 },
        { type: "OIL_CHANGE", intervalKm: 10_000, lastDoneAt: dayOffset(30) },
        { type: "OIL_CHANGE", intervalKm: 10_000, vehicleId: theirs },
      ]) {
        assert.equal((await newPlan(body)).status, 400, JSON.stringify(body));
      }
      const id = (await newPlan({ type: "TIRES", intervalKm: 40_000 })).json.plan.id;
      // Retirer le seul intervalle d'un plan est refusé.
      assert.equal((await call(ctx.app, "PUT", `/api/maintenance-plans/${id}`, alice, { intervalKm: null })).status, 400);
      assert.equal((await call(ctx.app, "PUT", `/api/maintenance-plans/${id}`, alice, { intervalKm: null, intervalDays: 730 })).status, 200);
    });

    it("réserve les plans à l'admin et cloisonne les clients", async () => {
      const body = { type: "OIL_CHANGE", intervalKm: 10_000 };
      assert.equal((await newPlan(body, agent)).status, 403);
      assert.equal((await newPlan(body, viewer)).status, 403);
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${theirs}/maintenance-plans`, alice, body)).status, 404);
      const id = (await newPlan(body)).json.plan.id;
      assert.equal((await call(ctx.app, "GET", `/api/vehicles/${car}/maintenance-plans`, bob)).status, 404);
      assert.equal((await call(ctx.app, "PUT", `/api/maintenance-plans/${id}`, bob, { active: false })).status, 404);
      assert.equal((await call(ctx.app, "DELETE", `/api/maintenance-plans/${id}`, bob)).status, 404);
      assert.equal((await call(ctx.app, "DELETE", `/api/maintenance-plans/${id}`, agent)).status, 403);
      assert.equal(await prisma.maintenancePlan.count(), 1);
    });
  });

  describe("Entretiens réalisés", () => {
    it("fait avancer la référence du plan et enregistre un relevé de compteur", async () => {
      const planId = (await newPlan({ type: "OIL_CHANGE", intervalKm: 10_000, lastDoneKm: 40_000, lastDoneAt: dayOffset(-300) })).json.plan.id;
      const res = await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, agent, { planId, doneOn: dayOffset(-1), km: 50_200, garage: "Garage Atlas", notes: "Filtre changé" });
      assert.equal(res.status, 201);
      assert.equal(res.json.record.type, "OIL_CHANGE");
      assert.equal(res.json.record.doneOn, dayOffset(-1));

      const plan = (await call(ctx.app, "GET", `/api/vehicles/${car}/maintenance-plans`, alice)).json.plans[0];
      assert.deepEqual([plan.lastDoneKm, plan.lastDoneAt, plan.nextKm, plan.status], [50_200, dayOffset(-1), 60_200, "OK"]);
      const reading = await prisma.odometerReading.findFirstOrThrow();
      assert.deepEqual([reading.km, reading.source], [50_200, "MAINTENANCE"]);

      // Un entretien plus ancien saisi après coup ne fait pas reculer la référence.
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, alice, { planId, doneOn: dayOffset(-100), km: 45_000 })).status, 201);
      assert.equal((await call(ctx.app, "GET", `/api/vehicles/${car}/maintenance-plans`, alice)).json.plans[0].lastDoneKm, 50_200);
      const history = await call(ctx.app, "GET", `/api/vehicles/${car}/maintenance-records`, viewer);
      assert.deepEqual(history.json.records.map((r: { km: number }) => r.km), [50_200, 45_000]);
    });

    it("accepte un entretien hors plan, refuse un compteur incohérent ou un plan d'un autre véhicule", async () => {
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, alice, { type: "BRAKES", doneOn: dayOffset(-2), km: 30_000 })).status, 201);
      const lower = await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, alice, { type: "TIRES", doneOn: dayOffset(-1), km: 20_000 });
      assert.equal(lower.json.code, "ODOMETER_DECREASE");
      for (const body of [{ doneOn: dayOffset(-1) }, { type: "OTHER", doneOn: dayOffset(-1) }, { type: "TIRES", doneOn: dayOffset(5) }, { type: "TIRES", doneOn: "hier" }]) {
        assert.equal((await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, alice, body)).status, 400, JSON.stringify(body));
      }
      const otherCar = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 9, name: "Master" } })).id;
      const otherPlan = (await call(ctx.app, "POST", `/api/vehicles/${otherCar}/maintenance-plans`, alice, { type: "TIRES", intervalKm: 40_000 })).json.plan.id;
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, alice, { planId: otherPlan, doneOn: dayOffset(-1) })).status, 400);
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, viewer, { type: "TIRES", doneOn: dayOffset(-1) })).status, 403);
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${theirs}/maintenance-records`, alice, { type: "TIRES", doneOn: dayOffset(-1) })).status, 404);
    });

    it("garde l'historique quand le plan est supprimé, et réserve la suppression d'un entretien à l'admin", async () => {
      const planId = (await newPlan({ type: "OIL_CHANGE", intervalKm: 10_000 })).json.plan.id;
      const recordId = (await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, alice, { planId, doneOn: dayOffset(-1) })).json.record.id;
      assert.equal((await call(ctx.app, "DELETE", `/api/maintenance-plans/${planId}`, alice)).status, 204);
      const kept = await prisma.maintenanceRecord.findUniqueOrThrow({ where: { id: recordId } });
      assert.equal(kept.planId, null);
      assert.equal((await call(ctx.app, "DELETE", `/api/maintenance-records/${recordId}`, agent)).status, 403);
      assert.equal((await call(ctx.app, "DELETE", `/api/maintenance-records/${recordId}`, bob)).status, 404);
      assert.equal((await call(ctx.app, "DELETE", `/api/maintenance-records/${recordId}`, alice)).status, 204);
    });
  });

  it("alerte une fois quand l'entretien est à prévoir, une fois en retard, puis repart après l'entretien", async () => {
    const planId = (await newPlan({ type: "SERVICE", intervalDays: 30, lastDoneAt: dayOffset(-20) })).json.plan.id; // dû dans 10 jours
    await newPlan({ type: "TIRES", intervalDays: 700, lastDoneAt: dayOffset(-20) });
    const registry: ScheduledTasks = { frequent: [], daily: [maintenanceAlertsTask] };
    const noon = (offset: number) => new Date(Date.parse(`${dayOffset(offset)}T12:00:00Z`));

    await runScheduledPass(noon(0), log, registry);
    await runScheduledPass(noon(1), log, registry);
    let events = await prisma.event.findMany({ orderBy: { createdAt: "asc" } });
    assert.deepEqual(events.map((e) => e.type), ["MAINTENANCE_DUE"]);
    assert.match(events[0]!.message!, /^Révision à prévoir : le \d{2}\/\d{2}\/\d{4}$/);

    await runScheduledPass(noon(11), log, registry);
    await runScheduledPass(noon(12), log, registry);
    events = await prisma.event.findMany({ orderBy: { createdAt: "asc" } });
    assert.deepEqual(events.map((e) => e.type), ["MAINTENANCE_DUE", "MAINTENANCE_OVERDUE"]);

    // Entretien fait aujourd'hui : le cycle suivant alertera de nouveau, 15 jours avant son échéance.
    await call(ctx.app, "POST", `/api/vehicles/${car}/maintenance-records`, alice, { planId, doneOn: dayOffset(0) });
    await runScheduledPass(noon(13), log, registry);
    assert.equal(await prisma.event.count(), 2);
    await runScheduledPass(noon(20), log, registry);
    assert.equal(await prisma.event.count({ where: { type: "MAINTENANCE_DUE" } }), 2);
  });
});
