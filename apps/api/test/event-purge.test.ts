import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import { eventPurgeTask, retentionDays } from "../src/lib/event-purge.js";
import { prisma } from "../src/lib/prisma.js";
import { createTenant, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());
const log = { error: () => {}, warn: () => {}, info: () => {} } as unknown as FastifyBaseLogger;

describe("purge des anciens événements", () => {
  beforeEach(() => resetState(ctx));

  it("ne purge rien sans durée valide", () => {
    assert.equal(retentionDays(undefined), null);
    assert.equal(retentionDays(""), null);
    assert.equal(retentionDays("10"), null);
    assert.equal(retentionDays("douze"), null);
    assert.equal(retentionDays("365"), 365);
  });

  it("supprime les événements du client plus anciens que la durée, et seulement eux", async () => {
    const a = await createTenant("alpha");
    const b = await createTenant("bravo");
    const now = new Date("2026-11-22T12:00:00Z");
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
    await prisma.event.createMany({
      data: [
        { tenantId: a.id, vehicleName: "A", type: "OVERSPEED", eventTime: ago(400), source: "APP", dedupKey: "a-old" },
        { tenantId: a.id, vehicleName: "A", type: "OVERSPEED", eventTime: ago(10), source: "APP", dedupKey: "a-new" },
        { tenantId: b.id, vehicleName: "B", type: "OVERSPEED", eventTime: ago(400), source: "APP", dedupKey: "b-old" },
      ],
    });
    const tenant = { id: a.id, timezone: "Europe/Paris" };
    await eventPurgeTask({ tenant, now, log, localDate: "2026-11-22" }, "");
    assert.equal(await prisma.event.count(), 3);
    await eventPurgeTask({ tenant, now, log, localDate: "2026-11-22" }, "365");
    assert.deepEqual((await prisma.event.findMany({ orderBy: { dedupKey: "asc" } })).map((e) => e.dedupKey), ["a-new", "b-old"]);
  });
});
