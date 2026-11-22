import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { recordAppEvent } from "../src/lib/events.js";
import { prisma } from "../src/lib/prisma.js";
import { pushText, setPushSender, type PushMessage, type PushTicket } from "../src/lib/push.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const T = (n: string) => `ExponentPushToken[${n}]`;

describe("Alertes, tranche 4 : notifications push", () => {
  let tenantA: string;
  let alice: Record<string, string>;
  let viewer: Record<string, string>;
  let bob: Record<string, string>;
  let sent: PushMessage[][];
  let reply: (m: PushMessage[]) => PushTicket[];

  beforeEach(async () => {
    await resetState(ctx);
    tenantA = (await createTenant("alpha")).id;
    const b = await createTenant("bravo");
    await createUser("alice@alpha.test", "TENANT_ADMIN", tenantA);
    await createUser("vic@alpha.test", "VIEWER", tenantA);
    await createUser("bob@bravo.test", "TENANT_ADMIN", b.id);
    alice = await login(ctx.app, "alice@alpha.test");
    viewer = await login(ctx.app, "vic@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
    sent = [];
    reply = (m) => m.map((_, i) => ({ status: "ok", id: String(i) }));
    setPushSender(async (messages) => {
      sent.push(messages);
      return reply(messages);
    });
  });
  afterEach(() => setPushSender(null));

  const register = (token: string, headers = alice, platform = "ANDROID") => call(ctx.app, "POST", "/api/me/push-tokens", headers, { token, platform });
  /** L'envoi est lancé sans être attendu : on laisse la boucle d'événements le terminer. */
  const flush = () => new Promise((r) => setTimeout(r, 300));
  const alert = (type = "OVERSPEED", key = "k1") =>
    recordAppEvent({ tenantId: tenantA, vehicleId: null, vehicleName: "Clio", type: type as never, eventTime: new Date(), dedupKey: key, message: "Contact mis hors des horaires autorisés" });

  it("enregistre un appareil, refuse un jeton invalide et le retire à la déconnexion", async () => {
    assert.equal((await register(T("abc"))).status, 204);
    assert.equal((await register(T("abc"))).status, 204);
    assert.equal(await prisma.pushToken.count(), 1);
    for (const token of ["n'importe quoi", "ExponentPushToken[]", `${T("a")}x`]) assert.equal((await register(token)).status, 400, token);
    assert.equal((await register(T("abc"), alice, "WEB")).status, 400);
    assert.equal((await call(ctx.app, "POST", "/api/me/push-tokens", {}, { token: T("x"), platform: "IOS" })).status, 401);
    // Un autre compte ne peut pas retirer l'appareil d'alice, mais peut s'y connecter ensuite.
    await call(ctx.app, "POST", "/api/me/push-tokens/remove", viewer, { token: T("abc") });
    assert.equal(await prisma.pushToken.count(), 1);
    await call(ctx.app, "POST", "/api/me/push-tokens/remove", alice, { token: T("abc") });
    assert.equal(await prisma.pushToken.count(), 0);
  });

  it("envoie chaque nouvelle alerte aux appareils du client qui ne l'ont pas masquée", async () => {
    await register(T("alice1"));
    await register(T("vic1"), viewer, "IOS");
    await register(T("bob1"), bob);
    await call(ctx.app, "PUT", "/api/me/alert-preferences", viewer, { mutedTypes: ["IGNITION_AFTER_HOURS"] });
    await alert("IGNITION_AFTER_HOURS");
    await alert("IGNITION_AFTER_HOURS"); // doublon : pas de seconde notification
    await flush();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.map((m) => [m.to, m.title, m.body, m.channelId]), [[T("alice1"), "Clio", "Contact mis hors des horaires autorisés", "alerts"]]);
    assert.ok(sent[0]![0]!.data.eventId);
  });

  it("oublie un appareil désinscrit et n'envoie rien à un compte désactivé", async () => {
    await register(T("old"));
    await register(T("vic1"), viewer);
    await prisma.user.updateMany({ where: { email: "vic@alpha.test" }, data: { disabledAt: new Date() } });
    reply = (m) => m.map(() => ({ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }));
    await alert("OVERSPEED", "k2");
    await flush();
    assert.deepEqual(sent.flat().map((m) => m.to), [T("old")]);
    assert.deepEqual((await prisma.pushToken.findMany()).map((t) => t.token), [T("vic1")]);
  });

  it("rédige le texte des alertes Traccar", () => {
    assert.equal(pushText({ id: "e", tenantId: "t", vehicleId: null, vehicleName: "Clio", type: "ZONE_EXIT", zoneName: "Dépôt" }), "Sortie de la zone Dépôt");
    assert.equal(pushText({ id: "e", tenantId: "t", vehicleId: null, vehicleName: "Clio", type: "OVERSPEED", speedKmh: 112.4 }), "Excès de vitesse (112 km/h)");
  });
});
