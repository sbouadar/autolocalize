import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import { runScheduledPass, type ScheduledTasks } from "../src/jobs/scheduler.js";
import { alertRulesTask, localClock, withinHours } from "../src/lib/alert-rules.js";
import { resetTraccarCache } from "../src/lib/traccar.js";
import { prisma } from "../src/lib/prisma.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const log = { error: () => {}, warn: () => {}, info: () => {} } as unknown as FastifyBaseLogger;
const registry: ScheduledTasks = { frequent: [alertRulesTask], daily: [] };

describe("Alertes, tranche 3 : règles et préférences", () => {
  let tenantA: string;
  let alice: Record<string, string>;
  let viewer: Record<string, string>;
  let bob: Record<string, string>;
  let car: string;
  let theirs: string;

  beforeEach(async () => {
    await resetState(ctx);
    resetTraccarCache();
    tenantA = (await createTenant("alpha")).id;
    const b = await createTenant("bravo");
    await prisma.tenant.updateMany({ data: { timezone: "Europe/Paris" } });
    await createUser("alice@alpha.test", "TENANT_ADMIN", tenantA);
    await createUser("vic@alpha.test", "VIEWER", tenantA);
    await createUser("bob@bravo.test", "TENANT_ADMIN", b.id);
    car = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 1, name: "Clio" } })).id;
    theirs = (await prisma.vehicle.create({ data: { tenantId: b.id, traccarDeviceId: 2, name: "B" } })).id;
    ctx.traccar.devices = [device({ id: 1, positionId: 11 }), device({ id: 2, positionId: 22 })];
    ctx.traccar.positions = [position({ id: 11, deviceId: 1 })];
    alice = await login(ctx.app, "alice@alpha.test");
    viewer = await login(ctx.app, "vic@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
  });

  const create = (body: Record<string, unknown>, headers = alice) => call(ctx.app, "POST", "/api/alert-rules", headers, body);

  it("calcule l'heure locale et la plage autorisée, y compris à cheval sur minuit", () => {
    // Samedi 21 novembre 2026, 23:30 à Paris.
    assert.deepEqual(localClock(new Date("2026-11-21T22:30:00Z"), "Europe/Paris"), { weekday: 6, minutes: 23 * 60 + 30, date: "2026-11-21" });
    const office = { startMinute: 7 * 60, endMinute: 19 * 60, days: [1, 2, 3, 4, 5] };
    assert.equal(withinHours({ weekday: 1, minutes: 8 * 60 }, office), true);
    assert.equal(withinHours({ weekday: 1, minutes: 20 * 60 }, office), false);
    assert.equal(withinHours({ weekday: 6, minutes: 8 * 60 }, office), false);
    const night = { startMinute: 22 * 60, endMinute: 6 * 60, days: [1, 2, 3, 4, 5, 6, 7] };
    assert.equal(withinHours({ weekday: 3, minutes: 23 * 60 }, night), true);
    assert.equal(withinHours({ weekday: 3, minutes: 5 * 60 }, night), true);
    assert.equal(withinHours({ weekday: 3, minutes: 12 * 60 }, night), false);
  });

  it("crée, liste, modifie et supprime des règles, réservées à l'admin du client", async () => {
    const zone = await prisma.zone.create({ data: { tenantId: tenantA, name: "Dépôt", latitude: 33, longitude: -7, radiusM: 500, traccarGeofenceId: 5 } });
    const res = await create({ type: "AFTER_HOURS", startMinute: 420, endMinute: 1140, days: [5, 1, 2, 3, 4, 1] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.json.rule.days, [1, 2, 3, 4, 5]);
    assert.equal(res.json.rule.summary, "Contact ou mouvement en dehors de : lun. mar. mer. jeu. ven. 07:00–19:00");
    await create({ type: "OFFLINE_DURATION", thresholdMinutes: 360, vehicleId: car });
    await create({ type: "ZONE_DWELL", zoneId: zone.id, thresholdMinutes: 90 });
    const list = (await call(ctx.app, "GET", "/api/alert-rules", viewer)).json.rules;
    assert.deepEqual(list.map((r: { summary: string }) => r.summary).slice(1), ["Traceur sans nouvelle depuis plus de 6 h", "Plus de 1 h 30 dans la zone Dépôt"]);
    assert.equal(list[1].vehicleName, "Clio");

    for (const body of [
      { type: "AFTER_HOURS", startMinute: 420 },
      { type: "AFTER_HOURS", startMinute: 420, endMinute: 420, days: [1] },
      { type: "AFTER_HOURS", startMinute: 420, endMinute: 1140, days: [] },
      { type: "OFFLINE_DURATION" },
      { type: "OFFLINE_DURATION", thresholdMinutes: 1 },
      { type: "ZONE_DWELL", thresholdMinutes: 60 },
      { type: "OFFLINE_DURATION", thresholdMinutes: 60, vehicleId: theirs },
      { type: "SPEED", thresholdMinutes: 60 },
    ]) {
      assert.equal((await create(body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await create({ type: "OFFLINE_DURATION", thresholdMinutes: 60 }, viewer)).status, 403);
    const id = res.json.rule.id;
    assert.equal((await call(ctx.app, "PUT", `/api/alert-rules/${id}`, alice, { enabled: false })).json.rule.enabled, false);
    assert.equal((await call(ctx.app, "PUT", `/api/alert-rules/${id}`, bob, { enabled: true })).status, 404);
    assert.equal((await call(ctx.app, "DELETE", `/api/alert-rules/${id}`, alice)).status, 204);
    // Supprimer la zone supprime la règle qui la surveille.
    await prisma.zone.delete({ where: { id: zone.id } });
    assert.equal(await prisma.alertRule.count(), 1);
  });

  it("alerte d'un contact mis hors horaires, une fois par jour", async () => {
    // Plage autorisée : du lundi au vendredi, 07:00–19:00 ; nous sommes samedi 23:30 à Paris.
    await create({ type: "AFTER_HOURS", startMinute: 420, endMinute: 1140, days: [1, 2, 3, 4, 5] });
    const now = new Date("2026-11-21T22:30:00Z");
    ctx.traccar.positions = [position({ id: 11, deviceId: 1, fixTime: new Date(now.getTime() - 60_000).toISOString(), speed: 0, attributes: { ignition: true } })];
    await runScheduledPass(now, log, registry);
    await runScheduledPass(new Date(now.getTime() + 5 * 60_000), log, registry);
    const events = await prisma.event.findMany();
    assert.deepEqual(events.map((e) => [e.type, e.vehicleId]), [["IGNITION_AFTER_HOURS", car]]);
    assert.equal(events[0]!.message, "Contact mis hors des horaires autorisés (lun. mar. mer. jeu. ven. 07:00–19:00)");
    // Dans la plage : rien.
    await prisma.event.deleteMany();
    await runScheduledPass(new Date("2026-11-23T09:00:00Z"), log, registry);
    assert.equal(await prisma.event.count(), 0);
  });

  it("alerte d'un traceur muet depuis plus que le seuil, une fois par silence", async () => {
    await create({ type: "OFFLINE_DURATION", thresholdMinutes: 120 });
    ctx.traccar.devices = [device({ id: 1, positionId: 11, status: "offline", lastUpdate: "2026-11-22T06:00:00.000Z" })];
    resetTraccarCache();
    await runScheduledPass(new Date("2026-11-22T07:00:00Z"), log, registry);
    assert.equal(await prisma.event.count(), 0);
    await runScheduledPass(new Date("2026-11-22T08:30:00Z"), log, registry);
    await runScheduledPass(new Date("2026-11-22T09:00:00Z"), log, registry);
    const events = await prisma.event.findMany();
    assert.deepEqual(events.map((e) => [e.type, e.message]), [["VEHICLE_OFFLINE_LONG", "Aucune nouvelle du traceur depuis plus de 2 h"]]);
  });

  it("alerte d'un véhicule resté trop longtemps dans une zone", async () => {
    const zone = await prisma.zone.create({ data: { tenantId: tenantA, name: "Dépôt", latitude: 33, longitude: -7, radiusM: 500, traccarGeofenceId: 5 } });
    await create({ type: "ZONE_DWELL", zoneId: zone.id, thresholdMinutes: 60 });
    const enter = new Date("2026-11-22T06:00:00Z");
    await prisma.event.create({ data: { tenantId: tenantA, vehicleId: car, vehicleName: "Clio", type: "ZONE_ENTER", zoneId: zone.id, zoneName: "Dépôt", eventTime: enter, traccarEventId: 900 } });
    await runScheduledPass(new Date("2026-11-22T06:30:00Z"), log, registry);
    assert.equal(await prisma.event.count({ where: { type: "ZONE_DWELL" } }), 0);
    await runScheduledPass(new Date("2026-11-22T07:10:00Z"), log, registry);
    await runScheduledPass(new Date("2026-11-22T07:15:00Z"), log, registry);
    const dwell = await prisma.event.findMany({ where: { type: "ZONE_DWELL" } });
    assert.deepEqual(dwell.map((e) => e.message), ["Dans la zone Dépôt depuis plus de 1 h"]);
    // Sortie de la zone : plus d'alerte.
    await prisma.event.create({ data: { tenantId: tenantA, vehicleId: car, vehicleName: "Clio", type: "ZONE_EXIT", zoneId: zone.id, zoneName: "Dépôt", eventTime: new Date("2026-11-22T07:20:00Z"), traccarEventId: 901 } });
    await prisma.event.deleteMany({ where: { type: "ZONE_DWELL" } });
    await runScheduledPass(new Date("2026-11-22T09:00:00Z"), log, registry);
    assert.equal(await prisma.event.count({ where: { type: "ZONE_DWELL" } }), 0);
  });

  it("masque les types d'alerte choisis par l'utilisateur, pour lui seul", async () => {
    await prisma.event.createMany({
      data: [
        { tenantId: tenantA, vehicleId: car, vehicleName: "Clio", type: "OVERSPEED", eventTime: new Date(), source: "APP", dedupKey: "a" },
        { tenantId: tenantA, vehicleId: car, vehicleName: "Clio", type: "ZONE_ENTER", eventTime: new Date(), source: "APP", dedupKey: "b" },
      ],
    });
    assert.deepEqual((await call(ctx.app, "GET", "/api/me/alert-preferences", viewer)).json.mutedTypes, []);
    assert.equal((await call(ctx.app, "PUT", "/api/me/alert-preferences", viewer, { mutedTypes: ["INCONNU"] })).status, 400);
    assert.deepEqual((await call(ctx.app, "PUT", "/api/me/alert-preferences", viewer, { mutedTypes: ["ZONE_ENTER", "ZONE_ENTER"] })).json.mutedTypes, ["ZONE_ENTER"]);
    assert.deepEqual((await call(ctx.app, "GET", "/api/alerts", viewer)).json.alerts.map((a: { type: string }) => a.type), ["OVERSPEED"]);
    assert.equal((await call(ctx.app, "GET", "/api/alerts?all=true", viewer)).json.alerts.length, 2);
    assert.equal((await call(ctx.app, "GET", "/api/alerts", alice)).json.alerts.length, 2);
  });
});
