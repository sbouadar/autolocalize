import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { prisma } from "../src/lib/prisma.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

describe("GET /api/vehicles et /api/me", () => {
  let alice: Record<string, string>;
  let bob: Record<string, string>;
  let root: Record<string, string>;

  beforeEach(async () => {
    await resetState(ctx);
    const a = await createTenant("alpha");
    const b = await createTenant("bravo");
    await createUser("alice@alpha.test", "TENANT_ADMIN", a.id);
    await createUser("bob@bravo.test", "TENANT_ADMIN", b.id);
    await createUser("root@autolocalize.test", "SUPER_ADMIN", null);
    await prisma.vehicle.createMany({
      data: [
        { tenantId: a.id, traccarDeviceId: 1, name: "Camion A" },
        { tenantId: b.id, traccarDeviceId: 2, name: "Camion B" },
      ],
    });
    ctx.traccar.devices = [device({ id: 1 }), device({ id: 2 })];
    ctx.traccar.positions = [position({ deviceId: 1, speed: 10 }), position({ deviceId: 2 })];
    alice = await login(ctx.app, "alice@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
    root = await login(ctx.app, "root@autolocalize.test");
  });

  it("refuse l'accès sans session", async () => {
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", null)).status, 401);
    assert.equal((await call(ctx.app, "GET", "/api/me", null)).status, 401);
  });

  it("ne renvoie que les véhicules du client connecté, enrichis par Traccar", async () => {
    const res = await call(ctx.app, "GET", "/api/vehicles", alice);
    assert.equal(res.status, 200);
    assert.equal(res.json.liveDataAvailable, true);
    assert.deepEqual(
      res.json.vehicles.map((v: { name: string }) => v.name),
      ["Camion A"],
    );
    assert.equal(res.json.vehicles[0].position.speedKmh, 18.5);
    assert.equal(res.json.vehicles[0].tenantId, undefined);

    const other = await call(ctx.app, "GET", "/api/vehicles", bob);
    assert.deepEqual(
      other.json.vehicles.map((v: { name: string }) => v.name),
      ["Camion B"],
    );
  });

  it("le super-admin voit tous les véhicules avec leur client", async () => {
    const res = await call(ctx.app, "GET", "/api/vehicles", root);
    assert.equal(res.json.vehicles.length, 2);
    assert.ok(res.json.vehicles.every((v: { tenantId?: string }) => v.tenantId));
  });

  it("renvoie la liste sans données temps réel si Traccar est en panne", async () => {
    ctx.traccar.down = true;
    const res = await call(ctx.app, "GET", "/api/vehicles", alice);
    assert.equal(res.status, 200);
    assert.equal(res.json.liveDataAvailable, false);
    assert.equal(res.json.vehicles[0].position, null);
    assert.doesNotMatch(res.body, /NullPointer/);
  });

  it("coupe l'accès dès que le client est suspendu", async () => {
    await prisma.tenant.update({ where: { slug: "alpha" }, data: { status: "SUSPENDED" } });
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", alice)).status, 403);
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", bob)).status, 200);
  });

  it("GET /me renvoie l'utilisateur et le branding de son client", async () => {
    const res = await call(ctx.app, "GET", "/api/me", alice);
    assert.equal(res.status, 200);
    assert.equal(res.json.user.email, "alice@alpha.test");
    assert.equal(res.json.tenant.slug, "alpha");
  });
});
