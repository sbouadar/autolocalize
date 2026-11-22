import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { prisma } from "../src/lib/prisma.js";
import { hashToken } from "../src/routes/share-links.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

describe("M10 : liens de partage", () => {
  let tenantA: string;
  let alice: Record<string, string>;
  let agent: Record<string, string>;
  let viewer: Record<string, string>;
  let bob: Record<string, string>;
  let car: string;

  beforeEach(async () => {
    await resetState(ctx);
    tenantA = (await createTenant("alpha")).id;
    const b = await createTenant("bravo");
    await createUser("alice@alpha.test", "TENANT_ADMIN", tenantA);
    await createUser("ali@alpha.test", "AGENT", tenantA);
    await createUser("vic@alpha.test", "VIEWER", tenantA);
    await createUser("bob@bravo.test", "TENANT_ADMIN", b.id);
    car = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 1, name: "Clio", plate: "1-A-1" } })).id;
    ctx.traccar.devices = [device({ id: 1, positionId: 11, status: "online" })];
    ctx.traccar.positions = [position({ id: 11, deviceId: 1, latitude: 33.57, longitude: -7.59, speed: 27 })];
    alice = await login(ctx.app, "alice@alpha.test");
    agent = await login(ctx.app, "ali@alpha.test");
    viewer = await login(ctx.app, "vic@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
  });

  const create = (body: Record<string, unknown> = { durationHours: 24 }, headers = agent) => call(ctx.app, "POST", `/api/vehicles/${car}/share-links`, headers, body);
  const open = (token: string) => call(ctx.app, "GET", `/api/public/share/${token}`, null);

  it("crée un lien dont seule l'empreinte est gardée, et l'ouvre sans compte", async () => {
    const res = await create({ durationHours: 24, label: "Client Karim" });
    assert.equal(res.status, 201);
    assert.equal(res.headers["cache-control"], "no-store");
    const { token, path, link } = res.json;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(path, `/share/${token}`);
    assert.equal(link.active, true);
    const stored = await prisma.shareLink.findFirstOrThrow();
    assert.equal(stored.tokenHash, hashToken(token));
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(token));

    const page = await open(token);
    assert.equal(page.status, 200);
    assert.deepEqual(Object.keys(page.json).sort(), ["expiresAt", "online", "position", "vehicleName"]);
    assert.equal(page.json.vehicleName, "Clio");
    assert.deepEqual([page.json.position.latitude, page.json.position.longitude, page.json.position.speedKmh, page.json.online], [33.57, -7.59, 50, true]);
    // Ni plaque ni client dans la réponse.
    assert.doesNotMatch(page.body, /1-A-1|alpha|Karim/);
    // La liste ne redonne jamais le jeton.
    const list = await call(ctx.app, "GET", `/api/vehicles/${car}/share-links`, alice);
    assert.equal(list.json.links[0].label, "Client Karim");
    assert.doesNotMatch(list.body, new RegExp(token));
  });

  it("répond 404 pour un lien révoqué, expiré, inconnu ou d'un client suspendu", async () => {
    const { token, link } = (await create()).json;
    assert.equal((await call(ctx.app, "DELETE", `/api/share-links/${link.id}`, bob)).status, 404);
    assert.equal((await call(ctx.app, "DELETE", `/api/share-links/${link.id}`, alice)).status, 204);
    assert.equal((await open(token)).status, 404);

    const second = (await create()).json.token;
    await prisma.shareLink.updateMany({ where: { revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await open(second)).status, 404);

    const third = (await create()).json.token;
    await prisma.tenant.update({ where: { id: tenantA }, data: { status: "SUSPENDED" } });
    assert.equal((await open(third)).status, 404);
    await prisma.tenant.update({ where: { id: tenantA }, data: { status: "ACTIVE" } });
    assert.equal((await open(third)).status, 200);

    assert.equal((await open("x".repeat(43))).status, 404);
    assert.equal((await open("court")).status, 404);
  });

  it("n'affiche pas une position au point 0,0, et répond 503 si Traccar est indisponible", async () => {
    const { token } = (await create()).json;
    ctx.traccar.positions = [position({ id: 11, deviceId: 1, latitude: 0, longitude: 0 })];
    assert.equal((await open(token)).json.position, null);
    ctx.traccar.down = true;
    assert.equal((await open(token)).status, 503);
  });

  it("valide la durée et réserve la création à l'admin et aux agents du client", async () => {
    for (const body of [{}, { durationHours: 0 }, { durationHours: 169 }, { durationHours: 1.5 }, { durationHours: 2, vehicleId: "x" }]) {
      assert.equal((await create(body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await create({ durationHours: 1 }, viewer)).status, 403);
    assert.equal((await create({ durationHours: 1 }, bob)).status, 404);
    assert.equal((await call(ctx.app, "GET", `/api/vehicles/${car}/share-links`, viewer)).status, 403);
    const actions = (await prisma.auditLog.findMany()).map((a) => a.action);
    assert.deepEqual(actions, []);
    await create({ durationHours: 1 });
    assert.deepEqual((await prisma.auditLog.findMany()).map((a) => a.action), ["share.create"]);
  });
});
