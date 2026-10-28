import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { prisma } from "../src/lib/prisma.js";
import { LOGO_DIR } from "./env.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, PASSWORD, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const NEW_PASSWORD = "mot-de-passe-definitif-1";

type Headers = Record<string, string>;
let root: Headers;
let alice: Headers;
let viewer: Headers;
let alphaId: string;

beforeEach(async () => {
  await resetState(ctx);
  const alpha = await createTenant("alpha");
  alphaId = alpha.id;
  await createUser("root@autolocalize.test", "SUPER_ADMIN", null);
  await createUser("alice@alpha.test", "TENANT_ADMIN", alpha.id);
  await createUser("victor@alpha.test", "VIEWER", alpha.id);
  ctx.traccar.devices = [device({ id: 1, name: "GPS libre" }), device({ id: 2, name: "GPS 2" })];
  ctx.traccar.positions = [position({ deviceId: 1 }), position({ deviceId: 2 })];
  root = await login(ctx.app, "root@autolocalize.test");
  alice = await login(ctx.app, "alice@alpha.test");
  viewer = await login(ctx.app, "victor@alpha.test");
});

const newTenant = (overrides: Record<string, unknown> = {}) => ({
  slug: "bravo-transport",
  name: "Bravo Transport",
  phone: "+212 5 22 00 00 00",
  admin: { name: "Bruno", email: "Bruno@Bravo.test" },
  ...overrides,
});

describe("Back-office : contrôle d'accès", () => {
  it("refuse toutes les routes /admin sans session (401) et hors super-admin (403)", async () => {
    const vehicle = await prisma.vehicle.create({ data: { tenantId: alphaId, traccarDeviceId: 2, name: "V" } });
    const routes: [("GET" | "POST" | "PUT" | "DELETE"), string, unknown?][] = [
      ["GET", "/api/admin/tenants"],
      ["POST", "/api/admin/tenants", newTenant()],
      ["GET", `/api/admin/tenants/${alphaId}`],
      ["PUT", `/api/admin/tenants/${alphaId}`, { status: "SUSPENDED" }],
      ["POST", `/api/admin/tenants/${alphaId}/logo`, { data: PNG.toString("base64") }],
      ["DELETE", `/api/admin/tenants/${alphaId}/logo`],
      ["POST", `/api/admin/tenants/${alphaId}/reset-password`, {}],
      ["GET", "/api/admin/devices"],
      ["POST", `/api/admin/tenants/${alphaId}/vehicles`, { name: "X", traccarDeviceId: 1 }],
      ["PUT", `/api/admin/vehicles/${vehicle.id}`, { name: "Piraté" }],
      ["DELETE", `/api/admin/vehicles/${vehicle.id}`],
      ["GET", "/api/admin/audit"],
    ];
    for (const [method, url, body] of routes) {
      assert.equal((await call(ctx.app, method, url, null, body)).status, 401, `${method} ${url} sans session`);
      assert.equal((await call(ctx.app, method, url, alice, body)).status, 403, `${method} ${url} admin client`);
      assert.equal((await call(ctx.app, method, url, viewer, body)).status, 403, `${method} ${url} lecture seule`);
    }
    // Aucun effet de bord.
    assert.equal(await prisma.tenant.count(), 1);
    assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: alphaId } })).status, "ACTIVE");
    assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).name, "V");
    assert.equal(await prisma.auditLog.count(), 0);
  });

  it("le super-admin accède au back-office", async () => {
    const res = await call(ctx.app, "GET", "/api/admin/tenants", root);
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.json.tenants.map((t: { slug: string; userCount: number }) => [t.slug, t.userCount]),
      [["alpha", 2]],
    );
  });
});

describe("Back-office : création d'un client et mot de passe provisoire", () => {
  it("crée le client et son compte, qui doit changer de mot de passe avant tout accès", async () => {
    const res = await call(ctx.app, "POST", "/api/admin/tenants", root, newTenant());
    assert.equal(res.status, 201);
    assert.equal(res.headers["cache-control"], "no-store");
    const { temporaryPassword, email } = res.json.admin;
    assert.equal(email, "bruno@bravo.test");
    assert.match(temporaryPassword, /^[A-Za-z0-9]{16}$/);

    const bruno = await login(ctx.app, email, temporaryPassword);
    const me = await call(ctx.app, "GET", "/api/me", bruno);
    assert.equal(me.status, 200);
    assert.equal(me.json.user.mustChangePassword, true);
    assert.equal(me.json.user.role, "TENANT_ADMIN");
    assert.equal(me.json.tenant.slug, "bravo-transport");

    const blocked = await call(ctx.app, "GET", "/api/vehicles", bruno);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, "PASSWORD_CHANGE_REQUIRED");

    const changed = await call(ctx.app, "POST", "/api/me/password", bruno, {
      currentPassword: temporaryPassword,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(changed.status, 204);
    const fresh = { ...bruno, cookie: String(changed.headers["set-cookie"]).split(";")[0]! };
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", fresh)).status, 200);
    assert.equal((await call(ctx.app, "GET", "/api/me", fresh)).json.user.mustChangePassword, false);

    // Le journal trace la création, sans le mot de passe.
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "tenant.create" } });
    assert.doesNotMatch(log.details ?? "", new RegExp(temporaryPassword));
  });

  it("valide la création", async () => {
    const cases: [Record<string, unknown>, number][] = [
      [newTenant({ slug: "alpha" }), 409],
      [newTenant({ admin: { name: "A", email: "ALICE@alpha.test" } }), 409],
      [newTenant({ slug: "admin" }), 400],
      [newTenant({ slug: "Avec Espaces" }), 400],
      [newTenant({ slug: "-tiret" }), 400],
      [newTenant({ primaryColor: "red" }), 400],
      [newTenant({ phone: "<script>" }), 400],
      [newTenant({ status: "ACTIVE" }), 400],
      [newTenant({ admin: { name: "B", email: "b@b.test", role: "SUPER_ADMIN" } }), 400],
      [newTenant({ admin: { name: "B", email: "pas-un-email" } }), 400],
    ];
    for (const [body, expected] of cases) {
      const res = await call(ctx.app, "POST", "/api/admin/tenants", root, body);
      assert.equal(res.status, expected, JSON.stringify(body));
    }
    assert.equal(await prisma.tenant.count(), 1);
    assert.equal(await prisma.user.count({ where: { role: "SUPER_ADMIN" } }), 1);
  });

  it("réinitialise le mot de passe du client et ferme ses sessions", async () => {
    const res = await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/reset-password`, root, {});
    assert.equal(res.status, 200);
    assert.equal(res.json.email, "alice@alpha.test");
    assert.equal((await call(ctx.app, "GET", "/api/me", alice)).status, 401);
    await assert.rejects(login(ctx.app, "alice@alpha.test", PASSWORD));
    const fresh = await login(ctx.app, "alice@alpha.test", res.json.temporaryPassword);
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", fresh)).json.code, "PASSWORD_CHANGE_REQUIRED");
  });
});

describe("Back-office : statut et branding", () => {
  it("suspendre un client coupe son accès, le réactiver le rétablit", async () => {
    assert.equal((await call(ctx.app, "PUT", `/api/admin/tenants/${alphaId}`, root, { status: "SUSPENDED" })).status, 200);
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", alice)).status, 403);
    assert.equal((await call(ctx.app, "PUT", `/api/admin/tenants/${alphaId}`, root, { status: "ACTIVE" })).status, 200);
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", alice)).status, 200);
    assert.equal((await call(ctx.app, "PUT", `/api/admin/tenants/${alphaId}`, root, { status: "PAYE" })).status, 400);
    assert.equal((await call(ctx.app, "PUT", "/api/admin/tenants/inconnu", root, { name: "X" })).status, 404);
  });

  it("l'admin du client modifie son seul branding, pas son statut", async () => {
    const bravo = await createTenant("bravo");
    const res = await call(ctx.app, "PUT", "/api/tenant/branding", alice, {
      name: "Alpha Logistique",
      address: "",
      primaryColor: "#0f766e",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.tenant.name, "Alpha Logistique");
    assert.equal(res.json.tenant.address, null);
    assert.equal(res.json.tenant.primaryColor, "#0F766E");
    assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: bravo.id } })).name, "Client bravo");

    for (const body of [{ status: "ACTIVE" }, { slug: "autre" }, { id: bravo.id, name: "x" }, { name: "" }]) {
      assert.equal((await call(ctx.app, "PUT", "/api/tenant/branding", alice, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await call(ctx.app, "PUT", "/api/tenant/branding", viewer, { name: "x" })).status, 403);
    assert.equal((await call(ctx.app, "PUT", "/api/tenant/branding", root, { name: "x" })).status, 403);
    assert.equal(await prisma.auditLog.count({ where: { action: "branding.update" } }), 1);
  });
});

describe("Back-office : logos", () => {
  it("accepte un PNG, le sert publiquement et remplace l'ancien fichier", async () => {
    const first = await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/logo`, root, {
      data: `data:image/png;base64,${PNG.toString("base64")}`,
    });
    assert.equal(first.status, 200);
    const url: string = first.json.logoUrl;
    assert.match(url, /^\/api\/public\/logos\/[a-f0-9]{32}\.png$/);

    const served = await ctx.app.inject({ method: "GET", url });
    assert.equal(served.statusCode, 200);
    assert.equal(served.headers["content-type"], "image/png");
    assert.equal(served.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(served.rawPayload, PNG);

    const second = await call(ctx.app, "POST", "/api/tenant/logo", alice, { data: PNG.toString("base64") });
    assert.equal(second.status, 200);
    assert.ok(!existsSync(join(LOGO_DIR, url.split("/").pop()!)), "l'ancien logo est supprimé");
    assert.equal((await ctx.app.inject({ method: "GET", url })).statusCode, 404);
  });

  it("refuse SVG, faux fichiers et logos trop lourds", async () => {
    const tooBig = Buffer.concat([PNG, Buffer.alloc(512 * 1024)]);
    for (const data of [SVG.toString("base64"), Buffer.from("pas une image").toString("base64"), "@@@", tooBig.toString("base64")]) {
      const res = await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/logo`, root, { data });
      assert.equal(res.status, 400);
    }
    assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: alphaId } })).logoUrl, null);
  });

  it("ne sert que des noms de fichiers générés (pas de traversée de chemin)", async () => {
    for (const url of [
      "/api/public/logos/..%2F..%2Fetc%2Fpasswd",
      "/api/public/logos/%2e%2e%2fpackage.json",
      "/api/public/logos/abc.svg",
      `/api/public/logos/${"a".repeat(32)}.png`,
    ]) {
      assert.equal((await ctx.app.inject({ method: "GET", url })).statusCode, 404, url);
    }
  });
});

describe("Back-office : traceurs", () => {
  it("affecte un appareil Traccar existant et crée le groupe du client", async () => {
    const res = await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/vehicles`, root, {
      name: "Camion 1",
      plate: "12345-A-6",
      traccarDeviceId: 1,
    });
    assert.equal(res.status, 201);
    assert.equal(ctx.traccar.groups.length, 1);
    const groupId = ctx.traccar.groups[0]!.id;
    assert.equal(ctx.traccar.devices.find((d) => d.id === 1)!.groupId, groupId);
    assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: alphaId } })).traccarGroupId, groupId);

    const list = await call(ctx.app, "GET", "/api/vehicles", alice);
    assert.deepEqual(
      list.json.vehicles.map((v: { name: string }) => v.name),
      ["Camion 1"],
    );

    // Deuxième traceur : le groupe existant est réutilisé.
    await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/vehicles`, root, { name: "Camion 2", traccarDeviceId: 2 });
    assert.equal(ctx.traccar.groups.length, 1);

    const devices = await call(ctx.app, "GET", "/api/admin/devices", root);
    assert.ok(devices.json.devices.every((d: { assignment: unknown }) => d.assignment !== null));
  });

  it("refuse une double affectation et un appareil inconnu", async () => {
    const bravo = await createTenant("bravo");
    await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/vehicles`, root, { name: "A", traccarDeviceId: 1 });
    const twice = await call(ctx.app, "POST", `/api/admin/tenants/${bravo.id}/vehicles`, root, { name: "B", traccarDeviceId: 1 });
    assert.equal(twice.status, 409);
    const unknown = await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/vehicles`, root, { name: "C", traccarDeviceId: 999 });
    assert.equal(unknown.status, 404);
    const both = await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/vehicles`, root, { name: "D", traccarDeviceId: 2, imei: "123456" });
    assert.equal(both.status, 400);
    assert.equal(await prisma.vehicle.count(), 1);
  });

  it("déclare un nouveau traceur par IMEI, sauf s'il existe déjà", async () => {
    const res = await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/vehicles`, root, { name: "Neuf", imei: "865190074149999" });
    assert.equal(res.status, 201);
    const created = ctx.traccar.devices.find((d) => d.uniqueId === "865190074149999")!;
    assert.equal(created.groupId, ctx.traccar.groups[0]!.id);
    assert.equal(res.json.vehicle.traccarDeviceId, created.id);

    const dup = await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/vehicles`, root, {
      name: "Doublon",
      imei: ctx.traccar.devices[0]!.uniqueId,
    });
    assert.equal(dup.status, 409);
  });

  it("fixe la date de début d'historique à l'affectation, puis la modifie", async () => {
    const before = Date.now();
    const plain = await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/vehicles`, root, { name: "A", traccarDeviceId: 1 });
    assert.ok(Date.parse(plain.json.vehicle.historyStartAt) >= before - 1000, "par défaut : maintenant");

    const start = "2026-10-01T00:00:00.000Z";
    const backdated = await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/vehicles`, root, {
      name: "B",
      traccarDeviceId: 2,
      historyStartAt: start,
    });
    assert.equal(backdated.status, 201);
    assert.equal(backdated.json.vehicle.historyStartAt, start);

    const id = plain.json.vehicle.id;
    const moved = await call(ctx.app, "PUT", `/api/admin/vehicles/${id}`, root, { historyStartAt: "2026-10-20T08:00:00+02:00" });
    assert.equal(moved.status, 200);
    assert.equal(moved.json.vehicle.historyStartAt, "2026-10-20T06:00:00.000Z");

    for (const bad of ["2099-01-01T00:00:00Z", "2000-01-01T00:00:00Z", "hier"]) {
      assert.equal((await call(ctx.app, "PUT", `/api/admin/vehicles/${id}`, root, { historyStartAt: bad })).status, 400, bad);
    }
    // Le client ne peut pas la modifier.
    assert.equal((await call(ctx.app, "PUT", `/api/admin/vehicles/${id}`, alice, { historyStartAt: start })).status, 403);
  });

  it("n'affecte rien si Traccar est en panne", async () => {
    ctx.traccar.down = true;
    const res = await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/vehicles`, root, { name: "X", traccarDeviceId: 1 });
    assert.equal(res.status, 503);
    assert.equal(await prisma.vehicle.count(), 0);
  });

  it("renomme puis retire un traceur ; le client ne le voit plus", async () => {
    const created = await call(ctx.app, "POST", `/api/admin/tenants/${alphaId}/vehicles`, root, { name: "A", traccarDeviceId: 1 });
    const id = created.json.vehicle.id;
    const renamed = await call(ctx.app, "PUT", `/api/admin/vehicles/${id}`, root, { name: "Benne", plate: "" });
    assert.equal(renamed.json.vehicle.name, "Benne");
    assert.equal(renamed.json.vehicle.plate, null);
    assert.equal((await call(ctx.app, "PUT", `/api/admin/vehicles/${id}`, root, { tenantId: "autre" })).status, 400);

    assert.equal((await call(ctx.app, "DELETE", `/api/admin/vehicles/${id}`, root)).status, 204);
    assert.equal((await call(ctx.app, "GET", "/api/vehicles", alice)).json.vehicles.length, 0);
    assert.equal(ctx.traccar.devices.find((d) => d.id === 1)!.groupId, 0);
    assert.equal((await call(ctx.app, "DELETE", `/api/admin/vehicles/${id}`, root)).status, 404);
  });
});

describe("Back-office : journal", () => {
  it("liste les actions avec leur auteur, filtrables par client", async () => {
    await call(ctx.app, "PUT", `/api/admin/tenants/${alphaId}`, root, { name: "Alpha 2" });
    await call(ctx.app, "POST", "/api/admin/tenants", root, newTenant());
    const all = await call(ctx.app, "GET", "/api/admin/audit", root);
    assert.deepEqual(
      all.json.entries.map((e: { action: string }) => e.action),
      ["tenant.create", "tenant.update"],
    );
    assert.equal(all.json.entries[0].actorEmail, "root@autolocalize.test");
    const alphaOnly = await call(ctx.app, "GET", `/api/admin/audit?tenantId=${alphaId}`, root);
    assert.deepEqual(
      alphaOnly.json.entries.map((e: { action: string }) => e.action),
      ["tenant.update"],
    );
  });
});
