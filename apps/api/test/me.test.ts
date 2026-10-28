import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { call, createTenant, createUser, login, PASSWORD, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const NEW_PASSWORD = "nouveau-mot-de-passe-42";

describe("POST /api/me/password", () => {
  beforeEach(async () => {
    await resetState(ctx);
    const a = await createTenant("alpha");
    await createUser("alice@alpha.test", "TENANT_ADMIN", a.id);
  });

  it("change le mot de passe, garde la session courante et révoque les autres", async () => {
    const phone = await login(ctx.app, "alice@alpha.test");
    const laptop = await login(ctx.app, "alice@alpha.test");

    const res = await call(ctx.app, "POST", "/api/me/password", laptop, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    assert.equal(res.status, 204);
    const setCookie = String(res.headers["set-cookie"] ?? "");
    assert.match(setCookie, /session_token=/);

    // Nouvelle session renvoyée : elle fonctionne.
    const fresh = { ...laptop, cookie: setCookie.split(";")[0]! };
    assert.equal((await call(ctx.app, "GET", "/api/me", fresh)).status, 200);
    // L'autre appareil est déconnecté.
    assert.equal((await call(ctx.app, "GET", "/api/me", phone)).status, 401);

    await assert.rejects(login(ctx.app, "alice@alpha.test", PASSWORD));
    await login(ctx.app, "alice@alpha.test", NEW_PASSWORD);
  });

  it("refuse un mot de passe actuel incorrect sans rien changer", async () => {
    const s = await login(ctx.app, "alice@alpha.test");
    const res = await call(ctx.app, "POST", "/api/me/password", s, { currentPassword: "faux-mot-de-passe", newPassword: NEW_PASSWORD });
    assert.equal(res.status, 400);
    assert.equal(res.json.code, "INVALID_PASSWORD");
    await login(ctx.app, "alice@alpha.test", PASSWORD);
  });

  it("valide le nouveau mot de passe", async () => {
    const s = await login(ctx.app, "alice@alpha.test");
    for (const body of [
      { currentPassword: PASSWORD, newPassword: "court" },
      { currentPassword: PASSWORD, newPassword: "x".repeat(129) },
      { currentPassword: PASSWORD, newPassword: PASSWORD },
      { newPassword: NEW_PASSWORD },
    ]) {
      assert.equal((await call(ctx.app, "POST", "/api/me/password", s, body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
  });

  it("exige une session", async () => {
    const res = await call(ctx.app, "POST", "/api/me/password", null, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    assert.equal(res.status, 401);
  });
});
