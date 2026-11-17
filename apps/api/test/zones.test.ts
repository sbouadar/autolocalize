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
  let bravoId: string;
  let mine: string;

  beforeEach(async () => {
    await resetState(ctx);
    const a = await createTenant("alpha");
    const b = await createTenant("bravo");
    alphaId = a.id;
    bravoId = b.id;
    await createUser("alice@alpha.test", "TENANT_ADMIN", a.id);
    await createUser("victor@alpha.test", "VIEWER", a.id);
    await createUser("bob@bravo.test", "TENANT_ADMIN", b.id);
    await createUser("root@autolocalize.test", "SUPER_ADMIN", null);
    mine = (await prisma.vehicle.create({ data: { tenantId: a.id, traccarDeviceId: 1, name: "A" } })).id;
    ctx.traccar.devices = [device({ id: 1, groupId: 7 })];
    alice = await login(ctx.app, "alice@alpha.test");
    victor = await login(ctx.app, "victor@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
    root = await login(ctx.app, "root@autolocalize.test");
  });

  const create = (headers: Record<string, string> | null, body: unknown = depot) => call(ctx.app, "POST", "/api/zones", headers, body);

  it("crée la zone dans Traccar et la lie aux seuls véhicules choisis", async () => {
    const res = await create(alice, { ...depot, vehicleIds: [mine] });
    assert.equal(res.status, 201);
    assert.deepEqual({ ...res.json.zone, id: undefined }, { ...depot, id: undefined, color: "#2563EB", vehicleIds: [mine] });

    assert.equal(ctx.traccar.geofences.length, 1);
    assert.equal(ctx.traccar.geofences[0]!.area, "CIRCLE (33.5731 -7.5898, 200)");
    assert.deepEqual(ctx.traccar.permissions, [{ deviceId: 1, geofenceId: ctx.traccar.geofences[0]!.id }]);
    assert.equal((await prisma.auditLog.findFirstOrThrow({ where: { action: "zone.create" } })).tenantId, alphaId);

    // Sans véhicule : zone affichée sur la carte, sans surveillance. Couleur suivante de la palette.
    const second = await create(alice, { ...depot, name: "Ville" });
    assert.deepEqual(second.json.zone.vehicleIds, []);
    assert.equal(second.json.zone.color, "#DC2626");
    assert.equal(ctx.traccar.permissions.length, 1);
  });

  it("ajoute et retire des véhicules surveillés à la modification", async () => {
    const other = (await prisma.vehicle.create({ data: { tenantId: alphaId, traccarDeviceId: 3, name: "C" } })).id;
    const id = (await create(alice, { ...depot, vehicleIds: [mine] })).json.zone.id as string;
    const geofenceId = ctx.traccar.geofences[0]!.id;

    const res = await call(ctx.app, "PUT", `/api/zones/${id}`, alice, { ...depot, vehicleIds: [other] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.zone.vehicleIds, [other]);
    assert.deepEqual(ctx.traccar.permissions, [{ deviceId: 3, geofenceId }]);

    // Modifier sans changer les véhicules ne touche pas aux liaisons.
    assert.equal((await call(ctx.app, "PUT", `/api/zones/${id}`, alice, { ...depot, name: "Renommée", vehicleIds: [other] })).status, 200);
    assert.deepEqual(ctx.traccar.permissions, [{ deviceId: 3, geofenceId }]);
  });

  it("refuse le véhicule d'un autre client et un sixième zonage du même véhicule", async () => {
    const foreign = (await prisma.vehicle.create({ data: { tenantId: bravoId, traccarDeviceId: 2, name: "B" } })).id;
    assert.equal((await create(alice, { ...depot, vehicleIds: [foreign] })).status, 400);
    assert.equal((await create(alice, { ...depot, vehicleIds: ["inconnu"] })).status, 400);
    assert.equal(ctx.traccar.geofences.length, 0);

    for (let i = 1; i <= 5; i++) {
      assert.equal((await create(alice, { ...depot, name: `Zone ${i}`, vehicleIds: [mine] })).status, 201);
    }
    const sixth = await create(alice, { ...depot, name: "Zone 6", vehicleIds: [mine] });
    assert.equal(sixth.status, 409);
    assert.match(sixth.body, /déjà surveillé par 5 zones/);
    assert.equal(ctx.traccar.geofences.length, 5);
    // Modifier l'une des cinq reste possible : elle ne compte pas contre elle-même.
    const first = (await prisma.zone.findFirstOrThrow({ where: { name: "Zone 1" } })).id;
    assert.equal((await call(ctx.app, "PUT", `/api/zones/${first}`, alice, { ...depot, name: "Zone 1 bis", vehicleIds: [mine] })).status, 200);
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
