import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { prisma } from "../src/lib/prisma.js";
import { MAX_USERS_PER_TENANT } from "../src/routes/tenant-users.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

describe("M2 : comptes du client et rôle agent", () => {
  let tenantA: string;
  let tenantB: string;
  let alice: Record<string, string>;
  let aliceId: string;
  let bobId: string;
  let vehicleId: string;

  beforeEach(async () => {
    await resetState(ctx);
    tenantA = (await createTenant("alpha")).id;
    tenantB = (await createTenant("bravo")).id;
    aliceId = (await createUser("alice@alpha.test", "TENANT_ADMIN", tenantA)).id;
    bobId = (await createUser("bob@bravo.test", "TENANT_ADMIN", tenantB)).id;
    vehicleId = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 1, name: "A" } })).id;
    ctx.traccar.devices = [device({ id: 1 })];
    ctx.traccar.positions = [position({ deviceId: 1 })];
    alice = await login(ctx.app, "alice@alpha.test");
  });

  it("crée un compte avec un mot de passe provisoire, à changer à la première connexion", async () => {
    const res = await call(ctx.app, "POST", "/api/tenant/users", alice, { name: "Ali", email: "Ali@Alpha.test", role: "AGENT" });
    assert.equal(res.status, 201);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.json.user.email, "ali@alpha.test");
    assert.equal(res.json.user.role, "AGENT");
    assert.match(res.json.temporaryPassword, /^[A-Za-z2-9]{16}$/);

    const ali = await login(ctx.app, "ali@alpha.test", res.json.temporaryPassword);
    const blocked = await call(ctx.app, "GET", "/api/vehicles", ali);
    assert.equal(blocked.json.code, "PASSWORD_CHANGE_REQUIRED");
    const me = await call(ctx.app, "GET", "/api/me", ali);
    assert.equal(me.json.tenant.id, tenantA);

    // Journal sans le mot de passe.
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "tenant.user.create" } });
    assert.ok(!log.details!.includes(res.json.temporaryPassword));
  });

  it("liste les seuls comptes du client et refuse les doublons, les rôles non prévus et l'excès de comptes", async () => {
    const list = await call(ctx.app, "GET", "/api/tenant/users", alice);
    assert.deepEqual(list.json.users.map((u: { email: string }) => u.email), ["alice@alpha.test"]);
    assert.equal(list.json.currentUserId, aliceId);

    assert.equal((await call(ctx.app, "POST", "/api/tenant/users", alice, { name: "X", email: "bob@bravo.test", role: "VIEWER" })).json.code, "EMAIL_TAKEN");
    for (const role of ["SUPER_ADMIN", "ROOT"]) {
      assert.equal((await call(ctx.app, "POST", "/api/tenant/users", alice, { name: "X", email: "x@alpha.test", role })).status, 400);
    }
    assert.equal(
      (await call(ctx.app, "POST", "/api/tenant/users", alice, { name: "X", email: "x@alpha.test", role: "VIEWER", tenantId: tenantB })).status,
      400,
    );

    for (let i = 1; i < MAX_USERS_PER_TENANT; i++) await createUser(`u${i}@alpha.test`, "VIEWER", tenantA);
    const full = await call(ctx.app, "POST", "/api/tenant/users", alice, { name: "X", email: "x@alpha.test", role: "VIEWER" });
    assert.equal(full.status, 409);
    assert.equal(full.json.code, "USER_LIMIT");
  });

  it("ne touche jamais au compte d'un autre client", async () => {
    for (const [method, path, body] of [
      ["PUT", `/api/tenant/users/${bobId}`, { role: "VIEWER" }],
      ["POST", `/api/tenant/users/${bobId}/reset-password`, {}],
      ["POST", `/api/tenant/users/${bobId}/disable`, {}],
    ] as const) {
      assert.equal((await call(ctx.app, method, path, alice, body)).status, 404, path);
    }
    const bob = await prisma.user.findUniqueOrThrow({ where: { id: bobId } });
    assert.equal(bob.role, "TENANT_ADMIN");
    assert.equal(bob.disabledAt, null);
  });

  it("est réservé à l'admin du client", async () => {
    await createUser("ali@alpha.test", "AGENT", tenantA);
    await createUser("vic@alpha.test", "VIEWER", tenantA);
    await createUser("root@plateforme.test", "SUPER_ADMIN", null);
    for (const email of ["ali@alpha.test", "vic@alpha.test", "root@plateforme.test"]) {
      const h = await login(ctx.app, email);
      assert.equal((await call(ctx.app, "GET", "/api/tenant/users", h)).status, 403, email);
    }
  });

  it("change le rôle d'un compte, mais ni le sien ni celui du dernier admin actif", async () => {
    const other = await createUser("admin2@alpha.test", "TENANT_ADMIN", tenantA);
    const self = await call(ctx.app, "PUT", `/api/tenant/users/${aliceId}`, alice, { role: "VIEWER" });
    assert.equal(self.json.code, "SELF_ROLE");
    // Changer son propre nom reste possible.
    assert.equal((await call(ctx.app, "PUT", `/api/tenant/users/${aliceId}`, alice, { name: "Alice M." })).status, 200);

    assert.equal((await call(ctx.app, "PUT", `/api/tenant/users/${other.id}`, alice, { role: "AGENT" })).json.user.role, "AGENT");
    // Le dernier admin actif ne peut pas être rétrogradé : voir le test « dernier admin actif ».
  });

  it("désactive un compte : sessions fermées, accès refusé ; puis le réactive", async () => {
    await createUser("ali@alpha.test", "AGENT", tenantA);
    const ali = await login(ctx.app, "ali@alpha.test");
    const aliId = (await prisma.user.findUniqueOrThrow({ where: { email: "ali@alpha.test" } })).id;
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", ali)).status, 200);

    const res = await call(ctx.app, "POST", `/api/tenant/users/${aliId}/disable`, alice, {});
    assert.equal(res.status, 200);
    assert.ok(res.json.user.disabledAt);
    assert.equal(await prisma.session.count({ where: { userId: aliId } }), 0);
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", ali)).status, 401);

    // Une nouvelle connexion n'ouvre rien.
    const again = await login(ctx.app, "ali@alpha.test");
    const denied = await call(ctx.app, "GET", "/api/me", again);
    assert.equal(denied.status, 403);
    assert.equal(denied.json.code, "ACCOUNT_DISABLED");
    assert.equal(await prisma.session.count({ where: { userId: aliId } }), 0);

    assert.equal((await call(ctx.app, "POST", `/api/tenant/users/${aliId}/enable`, alice, {})).json.user.disabledAt, null);
    const back = await login(ctx.app, "ali@alpha.test");
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", back)).status, 200);
  });

  it("refuse de se désactiver soi-même ou de désactiver le dernier admin actif", async () => {
    assert.equal((await call(ctx.app, "POST", `/api/tenant/users/${aliceId}/disable`, alice, {})).json.code, "SELF_DISABLE");
    // Super-admin connecté en tant que le client : alice est la dernière admin active.
    await createUser("root@plateforme.test", "SUPER_ADMIN", null);
    const root = await login(ctx.app, "root@plateforme.test");
    assert.equal((await call(ctx.app, "POST", `/api/admin/tenants/${tenantA}/impersonate`, root, {})).status, 204);
    const last = await call(ctx.app, "POST", `/api/tenant/users/${aliceId}/disable`, root, {});
    assert.equal(last.status, 409);
    assert.equal(last.json.code, "LAST_ADMIN");
    const demote = await call(ctx.app, "PUT", `/api/tenant/users/${aliceId}`, root, { role: "AGENT" });
    assert.equal(demote.json.code, "LAST_ADMIN");
  });

  it("réinitialise le mot de passe d'un compte et ferme ses sessions", async () => {
    await createUser("vic@alpha.test", "VIEWER", tenantA);
    const vic = await login(ctx.app, "vic@alpha.test");
    const vicId = (await prisma.user.findUniqueOrThrow({ where: { email: "vic@alpha.test" } })).id;
    const res = await call(ctx.app, "POST", `/api/tenant/users/${vicId}/reset-password`, alice, {});
    assert.equal(res.status, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", vic)).status, 401);
    await login(ctx.app, "vic@alpha.test", res.json.temporaryPassword);
  });

  it("donne à l'agent la saisie des relevés, mais ni la fiche du véhicule, ni les zones, ni la coupure moteur", async () => {
    await createUser("ali@alpha.test", "AGENT", tenantA);
    const ali = await login(ctx.app, "ali@alpha.test");
    assert.equal((await call(ctx.app, "POST", `/api/vehicles/${vehicleId}/odometer`, ali, { km: 1200 })).status, 201);
    const readingId = (await prisma.odometerReading.findFirstOrThrow()).id;
    assert.equal((await call(ctx.app, "DELETE", `/api/vehicles/${vehicleId}/odometer/${readingId}`, ali)).status, 403);
    assert.equal((await call(ctx.app, "PUT", `/api/vehicles/${vehicleId}`, ali, { brand: "X" })).status, 403);
    assert.equal((await call(ctx.app, "PUT", "/api/tenant/branding", ali, { name: "X" })).status, 403);
    assert.equal(
      (await call(ctx.app, "POST", "/api/zones", ali, { name: "Z", latitude: 33, longitude: -7, radiusM: 500, vehicleIds: [] })).status,
      403,
    );
    assert.equal((await call(ctx.app, "POST", `/api/vehicles/${vehicleId}/commands`, ali, { command: "ENGINE_STOP" })).status, 403);
    assert.equal((await call(ctx.app, "GET", `/api/vehicles/${vehicleId}/commands`, ali)).json.canSend, false);
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", ali)).status, 200);
  });
});
