import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { prisma } from "../src/lib/prisma.js";
import { device } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const depot = { name: "Dépôt", latitude: 33.5731, longitude: -7.5898, radiusM: 200 };

describe("Zones : /zones", () => {
  let alice: Record<string, string>;
  let victor: Record<string, string>;
  let bob: Record<string, string>;
  let root: Record<string, string>;
  let alphaId: string;

  beforeEach(async () => {
    await resetState(ctx);
    const a = await createTenant("alpha");
    const b = await createTenant("bravo");
    alphaId = a.id;
    await createUser("alice@alpha.test", "TENANT_ADMIN", a.id);
    await createUser("victor@alpha.test", "VIEWER", a.id);
    await createUser("bob@bravo.test", "TENANT_ADMIN", b.id);
    await createUser("root@autolocalize.test", "SUPER_ADMIN", null);
    await prisma.vehicle.create({ data: { tenantId: a.id, traccarDeviceId: 1, name: "A" } });
    ctx.traccar.devices = [device({ id: 1, groupId: 7 })];
    alice = await login(ctx.app, "alice@alpha.test");
    victor = await login(ctx.app, "victor@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
    root = await login(ctx.app, "root@autolocalize.test");
  });

  const create = (headers: Record<string, string> | null, body: unknown = depot) => call(ctx.app, "POST", "/api/zones", headers, body);

  it("crée la zone dans Traccar, la lie au groupe du client et y range ses traceurs", async () => {
    const res = await create(alice);
    assert.equal(res.status, 201);
    assert.deepEqual({ ...res.json.zone, id: undefined }, { ...depot, id: undefined });

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: alphaId } });
    assert.ok(tenant.traccarGroupId, "groupe Traccar créé pour le client");
    assert.equal(ctx.traccar.geofences.length, 1);
    assert.equal(ctx.traccar.geofences[0]!.area, "CIRCLE (33.5731 -7.5898, 200)");
    assert.deepEqual(ctx.traccar.permissions, [{ groupId: tenant.traccarGroupId, geofenceId: ctx.traccar.geofences[0]!.id }]);
    // Le traceur, affecté avant la création du groupe, y est rangé : sinon la zone ne le surveille pas.
    assert.equal(ctx.traccar.devices[0]!.groupId, tenant.traccarGroupId);
    assert.equal((await prisma.auditLog.findFirstOrThrow({ where: { action: "zone.create" } })).tenantId, alphaId);
  });

  it("liste les zones du client, y compris en lecture seule, sans celles des autres", async () => {
    await create(alice);
    await create(bob, { ...depot, name: "Zone de Bravo" });

    const viewer = await call(ctx.app, "GET", "/api/zones", victor);
    assert.equal(viewer.status, 200);
    assert.equal(viewer.json.canEdit, false);
    assert.deepEqual(viewer.json.zones.map((z: { name: string }) => z.name), ["Dépôt"]);
    assert.equal(viewer.json.zones[0].traccarGeofenceId, undefined);
    assert.equal((await call(ctx.app, "GET", "/api/zones", alice)).json.canEdit, true);
    assert.equal((await call(ctx.app, "GET", "/api/zones", root)).json.zones.length, 2);
    assert.equal((await call(ctx.app, "GET", "/api/zones", null)).status, 401);
  });

  it("réserve la création, la modification et la suppression à l'admin du client", async () => {
    const id = (await create(alice)).json.zone.id as string;
    assert.equal((await create(null)).status, 401);
    assert.equal((await create(victor)).status, 403);
    assert.equal((await create(root)).status, 403);
    assert.equal((await call(ctx.app, "PUT", `/api/zones/${id}`, victor, depot)).status, 403);
    assert.equal((await call(ctx.app, "DELETE", `/api/zones/${id}`, victor)).status, 403);
    assert.equal(ctx.traccar.geofences.length, 1);
  });

  it("traite la zone d'un autre client comme inexistante", async () => {
    const id = (await create(alice)).json.zone.id as string;
    assert.equal((await call(ctx.app, "PUT", `/api/zones/${id}`, bob, { ...depot, name: "Volée" })).status, 404);
    assert.equal((await call(ctx.app, "DELETE", `/api/zones/${id}`, bob)).status, 404);
    assert.equal(ctx.traccar.geofences[0]!.name, "Dépôt");
    assert.equal(await prisma.zone.count(), 1);
  });

  it("modifie puis supprime la zone, dans Traccar aussi", async () => {
    const id = (await create(alice)).json.zone.id as string;
    const updated = await call(ctx.app, "PUT", `/api/zones/${id}`, alice, { ...depot, name: "Chantier", radiusM: 500 });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.zone.radiusM, 500);
    assert.equal(ctx.traccar.geofences[0]!.name, "Chantier");
    assert.equal(ctx.traccar.geofences[0]!.area, "CIRCLE (33.5731 -7.5898, 500)");

    assert.equal((await call(ctx.app, "DELETE", `/api/zones/${id}`, alice)).status, 204);
    assert.equal(ctx.traccar.geofences.length, 0);
    assert.equal(await prisma.zone.count(), 0);
  });

  it("valide les données de la zone", async () => {
    const bad = [
      {},
      { ...depot, name: " " },
      { ...depot, radiusM: 10 },
      { ...depot, radiusM: 500_000 },
      { ...depot, radiusM: 120.5 },
      { ...depot, latitude: 91 },
      { ...depot, latitude: 0, longitude: 0 },
      { ...depot, tenantId: "autre" },
    ];
    for (const body of bad) assert.equal((await create(alice, body)).status, 400, JSON.stringify(body));
    assert.equal(ctx.traccar.geofences.length, 0);
  });

  it("n'enregistre rien si Traccar est en panne, sans détail interne", async () => {
    ctx.traccar.down = true;
    const res = await create(alice);
    assert.equal(res.status, 503);
    assert.doesNotMatch(res.body, /java|NullPointer/);
    assert.equal(await prisma.zone.count(), 0);

    ctx.traccar.down = false;
    const id = (await create(alice)).json.zone.id as string;
    ctx.traccar.down = true;
    assert.equal((await call(ctx.app, "PUT", `/api/zones/${id}`, alice, { ...depot, name: "Autre" })).status, 503);
    assert.equal((await call(ctx.app, "DELETE", `/api/zones/${id}`, alice)).status, 503);
    assert.equal((await prisma.zone.findFirstOrThrow()).name, "Dépôt");
  });

  it("limite le nombre de zones par client", async () => {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: alphaId } });
    await prisma.zone.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({ ...depot, name: `Zone ${i}`, tenantId: tenant.id, traccarGeofenceId: 5000 + i })),
    });
    assert.equal((await create(alice)).status, 409);
  });
});
