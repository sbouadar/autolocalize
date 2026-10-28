import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { prisma } from "../src/lib/prisma.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

describe("Commandes moteur : /vehicles/:id/commands", () => {
  let alice: Record<string, string>;
  let victor: Record<string, string>;
  let root: Record<string, string>;
  let mine: string;
  let theirs: string;

  beforeEach(async () => {
    await resetState(ctx);
    const a = await createTenant("alpha");
    const b = await createTenant("bravo");
    await createUser("alice@alpha.test", "TENANT_ADMIN", a.id);
    await createUser("victor@alpha.test", "VIEWER", a.id);
    await createUser("root@autolocalize.test", "SUPER_ADMIN", null);
    mine = (await prisma.vehicle.create({ data: { tenantId: a.id, traccarDeviceId: 1, name: "A" } })).id;
    theirs = (await prisma.vehicle.create({ data: { tenantId: b.id, traccarDeviceId: 2, name: "B" } })).id;
    ctx.traccar.devices = [device({ id: 1 }), device({ id: 2 })];
    ctx.traccar.positions = [position({ deviceId: 1, speed: 50 }), position({ deviceId: 2 })];
    alice = await login(ctx.app, "alice@alpha.test");
    victor = await login(ctx.app, "victor@alpha.test");
    root = await login(ctx.app, "root@autolocalize.test");
  });

  const stop = (headers: Record<string, string> | null, id = mine) =>
    call(ctx.app, "POST", `/api/vehicles/${id}/commands`, headers, { command: "ENGINE_STOP" });
  const sent = () => ctx.traccar.requests.filter((r) => r.path === "/api/commands/send");

  it("coupe le moteur, même en roulant, et journalise la vitesse", async () => {
    const res = await stop(alice);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { status: "SENT", queued: false });
    assert.deepEqual(sent()[0]!.body, { deviceId: 1, type: "engineStop", attributes: {} });

    const log = await prisma.commandLog.findFirstOrThrow({ where: { vehicleId: mine } });
    assert.equal(log.status, "SENT");
    assert.equal(log.command, "ENGINE_STOP");
    assert.equal(log.lastKnownSpeed, 92.6);
  });

  it("met la commande en attente si le traceur est hors ligne", async () => {
    ctx.traccar.devices = [device({ id: 1, status: "offline" }), device({ id: 2 })];
    const res = await stop(alice);
    assert.deepEqual(res.json, { status: "SENT", queued: true });
  });

  it("limite à une commande par minute et par véhicule", async () => {
    assert.equal((await stop(alice)).status, 200);
    const again = await call(ctx.app, "POST", `/api/vehicles/${mine}/commands`, alice, { command: "ENGINE_RESUME" });
    assert.equal(again.status, 429);
    assert.equal(sent().length, 1);
    const statuses = (await prisma.commandLog.findMany({ where: { vehicleId: mine }, orderBy: { createdAt: "asc" } })).map((l) => l.status);
    assert.deepEqual(statuses, ["SENT", "REJECTED"]);
  });

  it("refuse une commande que le traceur ne prend pas en charge", async () => {
    ctx.traccar.commandTypes[1] = ["custom"];
    const res = await stop(alice);
    assert.equal(res.status, 409);
    assert.equal(res.json.code, "COMMAND_UNSUPPORTED");
    assert.equal(sent().length, 0);
    assert.equal((await prisma.commandLog.findFirstOrThrow({ where: { vehicleId: mine } })).status, "REJECTED");
  });

  it("réserve l'envoi au compte du client et au super-admin", async () => {
    assert.equal((await stop(null)).status, 401);
    assert.equal((await stop(victor)).status, 403);
    assert.equal(sent().length, 0);
    assert.equal((await stop(root)).status, 200);
  });

  it("traite le véhicule d'un autre client comme inexistant", async () => {
    assert.equal((await stop(alice, theirs)).status, 404);
    assert.equal((await call(ctx.app, "GET", `/api/vehicles/${theirs}/commands`, alice)).status, 404);
    assert.equal(sent().length, 0);
    assert.equal(await prisma.commandLog.count(), 0);
  });

  it("valide la commande demandée", async () => {
    for (const body of [{}, { command: "REBOOT" }, { command: "ENGINE_STOP", deviceId: 2 }]) {
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/commands`, alice, body)).status, 400, JSON.stringify(body));
    }
    assert.equal(sent().length, 0);
  });

  it("journalise l'échec si Traccar est en panne, sans détail interne", async () => {
    ctx.traccar.down = true;
    const res = await stop(alice);
    assert.equal(res.status, 503);
    assert.doesNotMatch(res.body, /java|NullPointer/);
    assert.equal((await prisma.commandLog.findFirstOrThrow({ where: { vehicleId: mine } })).status, "FAILED");
  });

  it("permet de retirer un véhicule après une commande, en gardant le journal", async () => {
    assert.equal((await stop(alice)).status, 200);
    assert.equal((await call(ctx.app, "DELETE", `/api/admin/vehicles/${mine}`, root)).status, 204);
    const log = await prisma.commandLog.findFirstOrThrow({ where: { tenantId: { not: undefined }, command: "ENGINE_STOP" } });
    assert.equal(log.vehicleId, null);
    assert.equal(log.vehicleName, "A");
    assert.equal(log.traccarDeviceId, 1);
    assert.equal(log.status, "SENT");
  });

  it("indique les commandes possibles et l'historique, y compris en lecture seule", async () => {
    await stop(alice);
    const viewer = await call(ctx.app, "GET", `/api/vehicles/${mine}/commands`, victor);
    assert.equal(viewer.status, 200);
    assert.equal(viewer.json.canSend, false);
    assert.deepEqual(viewer.json.supported, { ENGINE_STOP: true, ENGINE_RESUME: true });
    assert.equal(viewer.json.history.length, 1);
    assert.equal(viewer.json.history[0].userName, "alice");
    assert.equal((await call(ctx.app, "GET", `/api/vehicles/${mine}/commands`, alice)).json.canSend, true);
  });
});
