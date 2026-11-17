import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { prisma } from "../src/lib/prisma.js";
import { EVENTS_SECRET } from "./env.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

describe("Événements Traccar et alertes", () => {
  let alice: Record<string, string>;
  let bob: Record<string, string>;
  let mine: string;
  let zoneId: string;
  let nextEventId: number;

  beforeEach(async () => {
    await resetState(ctx);
    nextEventId = 1;
    const a = await createTenant("alpha");
    const b = await createTenant("bravo");
    await createUser("alice@alpha.test", "TENANT_ADMIN", a.id);
    await createUser("bob@bravo.test", "TENANT_ADMIN", b.id);
    mine = (await prisma.vehicle.create({ data: { tenantId: a.id, traccarDeviceId: 1, name: "Camion" } })).id;
    await prisma.vehicle.create({ data: { tenantId: b.id, traccarDeviceId: 2, name: "Autre" } });
    zoneId = (await prisma.zone.create({ data: { tenantId: a.id, name: "Dépôt", latitude: 33.5, longitude: -7.6, radiusM: 200, traccarGeofenceId: 70 } })).id;
    await prisma.zone.create({ data: { tenantId: b.id, name: "Zone de Bravo", latitude: 34, longitude: -6.8, radiusM: 200, traccarGeofenceId: 71 } });
    alice = await login(ctx.app, "alice@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
  });

  const payload = (event: Record<string, unknown>, position: Record<string, unknown> | null = { latitude: 33.5, longitude: -7.6, speed: 20 }) => ({
    event: { id: nextEventId++, deviceId: 1, eventTime: "2026-11-17T10:00:00.000+00:00", attributes: {}, ...event },
    position,
    device: { id: 1, name: "ignoré" },
  });
  const forward = (body: unknown, secret: string | null = EVENTS_SECRET) =>
    call(ctx.app, "POST", "/api/internal/traccar/events", secret ? { "x-events-secret": secret } : null, body);
  const alerts = (headers: Record<string, string> | null, query = "") => call(ctx.app, "GET", `/api/alerts${query}`, headers);

  it("enregistre une entrée de zone et la montre au seul client concerné", async () => {
    const res = await forward(payload({ type: "geofenceEnter", geofenceId: 70 }));
    assert.equal(res.status, 200);
    assert.equal(res.json.result, "stored");

    const list = await alerts(alice);
    assert.equal(list.status, 200);
    assert.equal(list.json.hasMore, false);
    assert.deepEqual(
      { ...list.json.alerts[0], id: undefined },
      {
        id: undefined,
        type: "ZONE_ENTER",
        eventTime: "2026-11-17T10:00:00.000Z",
        vehicleId: mine,
        vehicleName: "Camion",
        zoneName: "Dépôt",
        latitude: 33.5,
        longitude: -7.6,
        speedKmh: 37,
        detail: null,
      },
    );
    assert.equal((await alerts(bob)).json.alerts.length, 0);
    assert.equal((await alerts(null)).status, 401);
  });

  it("refuse un appel sans le secret, comme une route inexistante", async () => {
    assert.equal((await forward(payload({ type: "alarm" }), null)).status, 404);
    assert.equal((await forward(payload({ type: "alarm" }), "x".repeat(EVENTS_SECRET.length))).status, 404);
    assert.equal((await forward(payload({ type: "alarm" }), alice.cookie!)).status, 404);
    assert.equal(await prisma.event.count(), 0);
  });

  it("n'enregistre qu'une fois un événement retransmis", async () => {
    const body = payload({ type: "deviceOverspeed" });
    assert.equal((await forward(body)).json.result, "stored");
    assert.equal((await forward(body)).json.result, "duplicate");
    assert.equal(await prisma.event.count(), 1);
  });

  it("ignore les types non suivis, les appareils sans client et les zones d'un autre client", async () => {
    assert.equal((await forward(payload({ type: "deviceMoving" }))).json.result, "ignored");
    assert.equal((await forward(payload({ type: "alarm", deviceId: 99 }))).json.result, "ignored");
    // Geofence d'un autre client, ou créée à la main dans Traccar : pas une zone du client du véhicule.
    assert.equal((await forward(payload({ type: "geofenceExit", geofenceId: 71 }))).json.result, "ignored");
    assert.equal((await forward(payload({ type: "geofenceExit", geofenceId: 999 }))).json.result, "ignored");
    assert.equal(await prisma.event.count(), 0);
  });

  it("rejette un message illisible", async () => {
    for (const body of [{}, { event: { type: "alarm" } }, { event: { id: 1, type: "alarm", deviceId: 1, eventTime: "hier" } }]) {
      assert.equal((await forward(body)).status, 400, JSON.stringify(body));
    }
  });

  it("garde le type d'alarme, masque la position 0,0 et n'affiche pas le contact dans les alertes", async () => {
    await forward(payload({ type: "alarm", attributes: { alarm: "lowBattery" } }, { latitude: 0, longitude: 0, speed: 0 }));
    await forward(payload({ type: "ignitionOn", eventTime: "2026-11-17T11:00:00.000+00:00" }, null));
    assert.equal(await prisma.event.count(), 2);

    const list = (await alerts(alice)).json.alerts;
    assert.equal(list.length, 1);
    assert.equal(list[0].type, "ALARM");
    assert.equal(list[0].detail, "lowBattery");
    assert.equal(list[0].latitude, null);
    assert.equal(list[0].speedKmh, null);
  });

  it("pagine les alertes de la plus récente à la plus ancienne et filtre par véhicule", async () => {
    for (let h = 1; h <= 3; h++) {
      await forward(payload({ type: "deviceOverspeed", eventTime: `2026-11-17T0${h}:00:00.000+00:00` }));
    }
    const first = await alerts(alice, "?limit=2");
    assert.deepEqual(first.json.alerts.map((a: { eventTime: string }) => a.eventTime.slice(11, 13)), ["03", "02"]);
    assert.equal(first.json.hasMore, true);
    const next = await alerts(alice, `?limit=2&before=${encodeURIComponent(first.json.alerts[1].eventTime)}`);
    assert.deepEqual(next.json.alerts.map((a: { eventTime: string }) => a.eventTime.slice(11, 13)), ["01"]);
    assert.equal(next.json.hasMore, false);

    assert.equal((await alerts(alice, `?vehicleId=${mine}`)).json.alerts.length, 3);
    assert.equal((await alerts(bob, `?vehicleId=${mine}`)).json.alerts.length, 0);
    assert.equal((await alerts(alice, "?limit=0")).status, 400);
  });

  it("garde l'alerte lisible après la suppression de la zone", async () => {
    await forward(payload({ type: "geofenceExit", geofenceId: 70 }));
    await prisma.zone.delete({ where: { id: zoneId } });
    const [alert] = (await alerts(alice)).json.alerts;
    assert.equal(alert.type, "ZONE_EXIT");
    assert.equal(alert.zoneName, "Dépôt");
  });
});
