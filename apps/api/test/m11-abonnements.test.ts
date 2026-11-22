import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { todayIn } from "../src/lib/deadlines.js";
import { prisma } from "../src/lib/prisma.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const day = (n: number) => new Date(Date.parse(`${todayIn("Africa/Casablanca")}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("M11 : abonnements", () => {
  let root: Record<string, string>;
  let alice: Record<string, string>;
  let alpha: string;
  let bravo: string;
  let charlie: string;

  beforeEach(async () => {
    await resetState(ctx);
    alpha = (await createTenant("alpha", { name: "Alpha" })).id;
    bravo = (await createTenant("bravo", { name: "Bravo" })).id;
    charlie = (await createTenant("charlie", { name: "Charlie" })).id;
    await createTenant("delta", { name: "Delta", status: "CANCELLED" });
    await createUser("root@autolocalize.test", "SUPER_ADMIN", null);
    await createUser("alice@alpha.test", "TENANT_ADMIN", alpha);
    ctx.traccar.devices = [device({ id: 1 }), device({ id: 2 })];
    ctx.traccar.positions = [position({ deviceId: 1 })];
    root = await login(ctx.app, "root@autolocalize.test");
    alice = await login(ctx.app, "alice@alpha.test");
  });

  const update = (id: string, body: Record<string, unknown>, headers = root) => call(ctx.app, "PUT", `/api/admin/tenants/${id}`, headers, body);

  it("enregistre la formule, le quota, le montant et l'échéance d'un client", async () => {
    const res = await update(alpha, { plan: " Pro ", vehicleQuota: 5, monthlyFee: 450.5, paidUntil: day(20), billingNotes: "Virement le 5" });
    assert.equal(res.status, 200);
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: alpha } });
    assert.deepEqual([t.plan, t.vehicleQuota, t.monthlyFee?.toFixed(2), t.paidUntil?.toISOString().slice(0, 10), t.billingNotes], ["Pro", 5, "450.50", day(20), "Virement le 5"]);
    // Les notes de facturation ne sont pas recopiées dans le journal.
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "tenant.update" } });
    assert.doesNotMatch(JSON.stringify(log.details), /Virement/);
    // Effacer.
    await update(alpha, { plan: "", paidUntil: null, monthlyFee: null });
    const cleared = await prisma.tenant.findUniqueOrThrow({ where: { id: alpha } });
    assert.deepEqual([cleared.plan, cleared.paidUntil, cleared.monthlyFee], [null, null, null]);
    for (const body of [{ vehicleQuota: -1 }, { monthlyFee: 10.123 }, { paidUntil: "2026-02-30" }, { paidUntil: "31/12/2026" }]) {
      assert.equal((await update(alpha, body)).status, 400, JSON.stringify(body));
    }
    // Réservé au super-admin.
    assert.equal((await update(alpha, { plan: "Gratuit" }, alice)).status, 403);
  });

  it("liste les échéances dépassées puis proches, les quotas dépassés et le revenu mensuel", async () => {
    await update(alpha, { paidUntil: day(30), monthlyFee: 300, vehicleQuota: 1 });
    await update(bravo, { paidUntil: day(-3), monthlyFee: 200 });
    await update(charlie, { paidUntil: day(5), monthlyFee: 100 });
    await prisma.tenant.update({ where: { id: charlie }, data: { currency: "EUR" } });
    await prisma.vehicle.createMany({
      data: [
        { tenantId: alpha, traccarDeviceId: 1, name: "A1" },
        { tenantId: alpha, traccarDeviceId: 2, name: "A2" },
      ],
    });

    const res = await call(ctx.app, "GET", "/api/admin/billing", root);
    assert.equal(res.status, 200);
    const b = res.json;
    assert.deepEqual(b.tenants.map((t: { name: string; billingStatus: string }) => [t.name, t.billingStatus]), [["Bravo", "OVERDUE"], ["Charlie", "DUE_SOON"], ["Alpha", "OK"]]);
    assert.deepEqual([b.tenants[0].daysLeft, b.tenants[2].vehicleCount, b.tenants[2].overQuota], [-3, 2, true]);
    assert.deepEqual(b.counts, { overdue: 1, dueSoon: 1, overQuota: 1 });
    assert.deepEqual(b.monthlyRevenue.sort((x: { currency: string }, y: { currency: string }) => x.currency.localeCompare(y.currency)), [
      { currency: "EUR", amount: "100.00" },
      { currency: "MAD", amount: "500.00" },
    ]);
    const list = (await call(ctx.app, "GET", "/api/admin/tenants", root)).json.tenants;
    assert.equal(list.find((t: { name: string }) => t.name === "Bravo").billingStatus, "OVERDUE");
    assert.equal((await call(ctx.app, "GET", "/api/admin/billing", alice)).status, 403);
  });

  it("indique le quota à l'affectation d'un traceur, sans bloquer", async () => {
    await update(alpha, { vehicleQuota: 1 });
    const first = await call(ctx.app, "POST", `/api/admin/tenants/${alpha}/vehicles`, root, { name: "A1", traccarDeviceId: 1 });
    assert.deepEqual(first.json.quota, { used: 1, max: 1, exceeded: false });
    const second = await call(ctx.app, "POST", `/api/admin/tenants/${alpha}/vehicles`, root, { name: "A2", traccarDeviceId: 2 });
    assert.equal(second.status, 201);
    assert.deepEqual(second.json.quota, { used: 2, max: 1, exceeded: true });
  });
});
