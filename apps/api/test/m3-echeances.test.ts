import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import { runScheduledPass, type ScheduledTasks } from "../src/jobs/scheduler.js";
import { daysBetween, deadlineAlertsTask, deadlineStatus, todayIn } from "../src/lib/deadlines.js";
import { prisma } from "../src/lib/prisma.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const log = { error: () => {}, warn: () => {}, info: () => {} } as unknown as FastifyBaseLogger;
/** AAAA-MM-JJ à n jours d'aujourd'hui, dans le fuseau du client de test (Europe/Paris). */
const inDays = (n: number) => new Date(Date.parse(`${todayIn("Europe/Paris")}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("M3 : échéances et indisponibilités", () => {
  let tenantA: string;
  let alice: Record<string, string>;
  let agent: Record<string, string>;
  let viewer: Record<string, string>;
  let bob: Record<string, string>;
  let mine: string;
  let theirs: string;

  beforeEach(async () => {
    await resetState(ctx);
    tenantA = (await createTenant("alpha")).id;
    await prisma.tenant.update({ where: { id: tenantA }, data: { timezone: "Europe/Paris" } });
    const b = await createTenant("bravo");
    await createUser("alice@alpha.test", "TENANT_ADMIN", tenantA);
    await createUser("ali@alpha.test", "AGENT", tenantA);
    await createUser("vic@alpha.test", "VIEWER", tenantA);
    await createUser("bob@bravo.test", "TENANT_ADMIN", b.id);
    mine = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 1, name: "Clio" } })).id;
    theirs = (await prisma.vehicle.create({ data: { tenantId: b.id, traccarDeviceId: 2, name: "B" } })).id;
    alice = await login(ctx.app, "alice@alpha.test");
    agent = await login(ctx.app, "ali@alpha.test");
    viewer = await login(ctx.app, "vic@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
  });

  describe("Échéances", () => {
    it("crée une échéance et calcule son état dans le fuseau du client", async () => {
      const res = await call(ctx.app, "POST", `/api/vehicles/${mine}/deadlines`, alice, {
        type: "INSURANCE",
        expiresOn: inDays(10),
        reference: "POL-123",
      });
      assert.equal(res.status, 201);
      assert.equal(res.json.deadline.daysLeft, 10);
      assert.equal(res.json.deadline.status, "WARNING"); // délai d'avertissement par défaut : 30 jours
      assert.equal(res.json.deadline.vehicleName, "Clio");

      await call(ctx.app, "POST", `/api/vehicles/${mine}/deadlines`, alice, { type: "ROAD_TAX", expiresOn: inDays(200) });
      await call(ctx.app, "POST", `/api/vehicles/${mine}/deadlines`, alice, { type: "TECHNICAL_INSPECTION", expiresOn: inDays(-3) });

      const all = await call(ctx.app, "GET", "/api/deadlines", viewer);
      assert.deepEqual(all.json.deadlines.map((d: { status: string }) => d.status), ["EXPIRED", "WARNING", "OK"]);
      // Filtre : dépassées et à moins de 30 jours.
      const soon = await call(ctx.app, "GET", "/api/deadlines?dueWithinDays=30", viewer);
      assert.deepEqual(soon.json.deadlines.map((d: { type: string }) => d.type), ["TECHNICAL_INSPECTION", "INSURANCE"]);
      assert.equal((await call(ctx.app, "GET", `/api/vehicles/${mine}/deadlines`, agent)).json.deadlines.length, 3);
    });

    it("valide la date, le type et le nom d'une échéance « autre »", async () => {
      for (const body of [
        { type: "INSURANCE", expiresOn: "2026-02-31" },
        { type: "INSURANCE", expiresOn: "31/12/2026" },
        { type: "PERMIS", expiresOn: inDays(5) },
        { type: "OTHER", expiresOn: inDays(5) },
        { type: "INSURANCE", expiresOn: inDays(5), warnDaysBefore: 1000 },
        { type: "INSURANCE", expiresOn: inDays(5), tenantId: "x" },
      ]) {
        assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/deadlines`, alice, body)).status, 400, JSON.stringify(body));
      }
      const other = await call(ctx.app, "POST", `/api/vehicles/${mine}/deadlines`, alice, { type: "OTHER", label: "Extincteur", expiresOn: inDays(5) });
      assert.equal(other.status, 201);
      // On ne peut pas retirer le nom d'une échéance « autre ».
      assert.equal((await call(ctx.app, "PUT", `/api/deadlines/${other.json.deadline.id}`, alice, { label: "" })).status, 400);
    });

    it("réserve l'écriture à l'admin et cloisonne les clients", async () => {
      const body = { type: "INSURANCE", expiresOn: inDays(5) };
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/deadlines`, agent, body)).status, 403);
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/deadlines`, viewer, body)).status, 403);
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${theirs}/deadlines`, alice, body)).status, 404);
      const id = (await call(ctx.app, "POST", `/api/vehicles/${mine}/deadlines`, alice, body)).json.deadline.id;

      assert.equal((await call(ctx.app, "GET", `/api/vehicles/${mine}/deadlines`, bob)).status, 404);
      assert.deepEqual((await call(ctx.app, "GET", "/api/deadlines", bob)).json.deadlines, []);
      assert.equal((await call(ctx.app, "PUT", `/api/deadlines/${id}`, bob, { warnDaysBefore: 1 })).status, 404);
      assert.equal((await call(ctx.app, "DELETE", `/api/deadlines/${id}`, bob)).status, 404);
      assert.equal((await call(ctx.app, "DELETE", `/api/deadlines/${id}`, agent)).status, 403);
      assert.equal((await call(ctx.app, "DELETE", `/api/deadlines/${id}`, alice)).status, 204);
      assert.equal(await prisma.vehicleDeadline.count(), 0);
    });

    it("alerte une fois avant l'expiration, une fois après, et de nouveau après un renouvellement", async () => {
      const id = (await call(ctx.app, "POST", `/api/vehicles/${mine}/deadlines`, alice, { type: "INSURANCE", expiresOn: inDays(10) })).json.deadline.id;
      await call(ctx.app, "POST", `/api/vehicles/${mine}/deadlines`, alice, { type: "ROAD_TAX", expiresOn: inDays(200) });
      const registry: ScheduledTasks = { frequent: [], daily: [deadlineAlertsTask] };
      // Midi UTC : l'après-midi à Paris, la passe quotidienne a lieu.
      const noon = (offsetDays: number) => new Date(Date.parse(`${inDays(offsetDays)}T12:00:00Z`));

      await runScheduledPass(noon(0), log, registry);
      await runScheduledPass(noon(1), log, registry);
      let events = await prisma.event.findMany({ orderBy: { createdAt: "asc" } });
      assert.deepEqual(events.map((e) => e.type), ["DOCUMENT_EXPIRING"]);
      assert.match(events[0]!.message!, /^Assurance : expire le \d{2}\/\d{2}\/\d{4} \(dans 10 jours\)$/);
      assert.equal(events[0]!.vehicleName, "Clio");

      await runScheduledPass(noon(11), log, registry);
      await runScheduledPass(noon(12), log, registry);
      events = await prisma.event.findMany({ orderBy: { createdAt: "asc" } });
      assert.deepEqual(events.map((e) => e.type), ["DOCUMENT_EXPIRING", "DOCUMENT_EXPIRED"]);

      // Renouvellement : la nouvelle date fait repartir les alertes le moment venu.
      assert.equal((await call(ctx.app, "PUT", `/api/deadlines/${id}`, alice, { expiresOn: inDays(60) })).json.deadline.status, "OK");
      await runScheduledPass(noon(13), log, registry); // 47 jours avant la nouvelle date : rien
      assert.equal(await prisma.event.count(), 2);
      await runScheduledPass(noon(35), log, registry); // 25 jours avant : nouvelle alerte
      assert.equal(await prisma.event.count({ where: { type: "DOCUMENT_EXPIRING" } }), 2);

      // Visibles dans les alertes du client, pas dans celles d'un autre.
      assert.equal((await call(ctx.app, "GET", "/api/alerts", viewer)).json.alerts.length, 3);
      assert.equal((await call(ctx.app, "GET", "/api/alerts", bob)).json.alerts.length, 0);
    });

    it("calcule les jours restants et l'état", () => {
      assert.equal(daysBetween("2026-11-22", "2026-12-01"), 9);
      assert.equal(daysBetween("2026-11-22", "2026-11-21"), -1);
      assert.equal(deadlineStatus(31, 30), "OK");
      assert.equal(deadlineStatus(30, 30), "WARNING");
      assert.equal(deadlineStatus(0, 30), "WARNING");
      assert.equal(deadlineStatus(-1, 30), "EXPIRED");
    });
  });

  describe("Indisponibilités", () => {
    const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

    it("crée, liste, modifie et supprime une indisponibilité (admin ou agent)", async () => {
      const res = await call(ctx.app, "POST", `/api/vehicles/${mine}/unavailabilities`, agent, {
        startAt: at(-1),
        reason: "REPAIR",
        notes: "Embrayage",
      });
      assert.equal(res.status, 201);
      assert.equal(res.json.unavailability.current, true);
      assert.equal(res.json.unavailability.endAt, null);
      const id = res.json.unavailability.id;

      await call(ctx.app, "POST", `/api/vehicles/${mine}/unavailabilities`, alice, { startAt: at(48), endAt: at(72), reason: "MAINTENANCE" });
      await call(ctx.app, "POST", `/api/vehicles/${mine}/unavailabilities`, alice, { startAt: at(-72), endAt: at(-48), reason: "OTHER" });

      const list = await call(ctx.app, "GET", `/api/vehicles/${mine}/unavailabilities`, viewer);
      assert.deepEqual(list.json.unavailabilities.map((u: { reason: string }) => u.reason), ["REPAIR", "MAINTENANCE", "OTHER"]);
      const current = await call(ctx.app, "GET", "/api/unavailabilities/current", viewer);
      assert.deepEqual(current.json.unavailabilities.map((u: { vehicleName: string; reason: string }) => [u.vehicleName, u.reason]), [["Clio", "REPAIR"]]);

      // Fin de l'immobilisation.
      const ended = await call(ctx.app, "PUT", `/api/unavailabilities/${id}`, agent, { endAt: at(-0.5) });
      assert.equal(ended.json.unavailability.current, false);
      assert.deepEqual((await call(ctx.app, "GET", "/api/unavailabilities/current", viewer)).json.unavailabilities, []);
      assert.equal((await call(ctx.app, "DELETE", `/api/unavailabilities/${id}`, agent)).status, 204);
    });

    it("refuse une fin avant le début, un motif inconnu, et les comptes en lecture seule", async () => {
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/unavailabilities`, alice, { startAt: at(2), endAt: at(1), reason: "REPAIR" })).status, 400);
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/unavailabilities`, alice, { startAt: at(1), reason: "VACANCES" })).status, 400);
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${mine}/unavailabilities`, viewer, { startAt: at(1), reason: "REPAIR" })).status, 403);
      const id = (await call(ctx.app, "POST", `/api/vehicles/${mine}/unavailabilities`, alice, { startAt: at(1), endAt: at(5), reason: "REPAIR" })).json.unavailability.id;
      assert.equal((await call(ctx.app, "PUT", `/api/unavailabilities/${id}`, alice, { startAt: at(6) })).status, 400);
    });

    it("cloisonne les clients", async () => {
      const id = (await call(ctx.app, "POST", `/api/vehicles/${mine}/unavailabilities`, alice, { startAt: at(-1), reason: "ACCIDENT" })).json.unavailability.id;
      assert.equal((await call(ctx.app, "POST", `/api/vehicles/${theirs}/unavailabilities`, alice, { startAt: at(1), reason: "REPAIR" })).status, 404);
      assert.equal((await call(ctx.app, "GET", `/api/vehicles/${mine}/unavailabilities`, bob)).status, 404);
      assert.deepEqual((await call(ctx.app, "GET", "/api/unavailabilities/current", bob)).json.unavailabilities, []);
      assert.equal((await call(ctx.app, "PUT", `/api/unavailabilities/${id}`, bob, { reason: "OTHER" })).status, 404);
      assert.equal((await call(ctx.app, "DELETE", `/api/unavailabilities/${id}`, bob)).status, 404);
      assert.equal(await prisma.vehicleUnavailability.count(), 1);
    });
  });
});
