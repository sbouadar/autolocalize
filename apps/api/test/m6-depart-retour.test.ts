import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import sharp from "sharp";
import { recordTraccarEvent } from "../src/lib/events.js";
import { prisma } from "../src/lib/prisma.js";
import { overdueRentalsTask, unauthorizedUseTask } from "../src/lib/rental-alerts.js";
import { RENTAL_FILES_DIR } from "./env.js";
import { device, position } from "./fake-traccar.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const log = { error: () => {}, warn: () => {}, info: () => {} } as unknown as FastifyBaseLogger;
const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const CIN = "BK123456";

/** Photo JPEG avec des métadonnées EXIF reconnaissables (comme la position d'un téléphone). */
async function photoWithExif(): Promise<string> {
  const bytes = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#336699" } })
    .withExif({ IFD0: { Copyright: "POSITION-SECRETE-33.5731" } })
    .jpeg()
    .toBuffer();
  assert.ok(bytes.includes("POSITION-SECRETE"));
  return bytes.toString("base64");
}

/** Téléchargement binaire authentifié. */
async function download(url: string, headers: Record<string, string>) {
  const res = await ctx.app.inject({ method: "GET", url, headers });
  return { status: res.statusCode, bytes: res.rawPayload, headers: res.headers };
}

describe("M6 : départ, retour, photos, contrat et alertes de location", () => {
  let tenantA: string;
  let alice: Record<string, string>;
  let agent: Record<string, string>;
  let viewer: Record<string, string>;
  let bob: Record<string, string>;
  let car: string;
  let customer: string;
  let rentalId: string;

  beforeEach(async () => {
    await resetState(ctx);
    tenantA = (await createTenant("alpha", { name: "Alpha Location" })).id;
    const b = await createTenant("bravo");
    await prisma.tenant.updateMany({ data: { rentalsEnabled: true, timezone: "Europe/Paris" } });
    await createUser("alice@alpha.test", "TENANT_ADMIN", tenantA);
    await createUser("ali@alpha.test", "AGENT", tenantA);
    await createUser("vic@alpha.test", "VIEWER", tenantA);
    await createUser("bob@bravo.test", "TENANT_ADMIN", b.id);
    car = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 1, name: "Clio", plate: "1-A-1", brand: "Renault", model: "Clio" } })).id;
    ctx.traccar.devices = [device({ id: 1 })];
    ctx.traccar.positions = [position({ deviceId: 1 })];
    alice = await login(ctx.app, "alice@alpha.test");
    agent = await login(ctx.app, "ali@alpha.test");
    viewer = await login(ctx.app, "vic@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
    customer = (await call(ctx.app, "POST", "/api/customers", alice, { name: "Karim Alaoui", idDocumentType: "NATIONAL_ID", idDocumentNumber: CIN })).json.customer.id;
    rentalId = (await call(ctx.app, "POST", "/api/rentals", alice, { vehicleId: car, customerId: customer, startAt: at(-1), endAt: at(47), price: 900, deposit: 3000 })).json.rental.id;
  });

  const pickup = (body: Record<string, unknown> = {}, headers = agent) =>
    call(ctx.app, "POST", `/api/rentals/${rentalId}/pickup`, headers, { odometerKm: 45_000, fuelLevel: 6, ...body });
  const giveBack = (body: Record<string, unknown> = {}, headers = agent) =>
    call(ctx.app, "POST", `/api/rentals/${rentalId}/return`, headers, { odometerKm: 45_320, fuelLevel: 4, ...body });

  describe("Départ", () => {
    it("enregistre le départ, le relevé de compteur et fige un contrat PDF", async () => {
      const res = await pickup();
      assert.equal(res.status, 200);
      assert.equal(res.json.rental.status, "ONGOING");
      assert.equal(res.json.rental.odometerOutKm, 45_000);
      assert.equal(res.json.rental.fuelOut, 6);
      assert.ok(res.json.rental.pickedUpAt);

      const reading = await prisma.odometerReading.findFirstOrThrow();
      assert.deepEqual([reading.km, reading.source, reading.rentalId], [45_000, "RENTAL_OUT", rentalId]);

      const contract = await prisma.rentalContract.findUniqueOrThrow({ where: { rentalId } });
      const pdf = await download(`/api/rentals/${rentalId}/contract.pdf`, viewer);
      assert.equal(pdf.status, 200);
      assert.equal(pdf.headers["content-type"], "application/pdf");
      assert.equal(pdf.headers["cache-control"], "private, no-store");
      assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
      assert.ok(pdf.bytes.length > 1500);
      const { createHash } = await import("node:crypto");
      assert.equal(createHash("sha256").update(pdf.bytes).digest("hex"), contract.sha256);

      // Figé : modifier le locataire ensuite ne change pas le contrat.
      await call(ctx.app, "PUT", `/api/customers/${customer}`, alice, { name: "Autre Nom" });
      const again = await download(`/api/rentals/${rentalId}/contract.pdf`, alice);
      assert.ok(again.bytes.equals(pdf.bytes));
    });

    it("refuse un second départ, un compteur qui recule, et les comptes en lecture seule", async () => {
      assert.equal((await pickup({}, viewer)).status, 403);
      await call(ctx.app, "POST", `/api/vehicles/${car}/odometer`, alice, { km: 50_000, readAt: at(-10) });
      const lower = await pickup();
      assert.equal(lower.json.code, "ODOMETER_DECREASE");
      assert.equal((await prisma.rental.findUniqueOrThrow({ where: { id: rentalId } })).status, "RESERVED");
      assert.equal(await prisma.rentalContract.count(), 0);

      assert.equal((await pickup({ odometerKm: 50_010 })).status, 200);
      assert.equal((await pickup({ odometerKm: 50_020 })).json.code, "RENTAL_NOT_RESERVED");
      assert.equal(await prisma.rentalContract.count(), 1);
      for (const body of [{ fuelLevel: 9 }, { odometerKm: -5 }, { at: at(5) }]) {
        assert.equal((await pickup(body)).status, 400, JSON.stringify(body));
      }
    });

    it("n'enregistre qu'un départ sur deux demandes simultanées", async () => {
      const results = await Promise.all([pickup(), pickup()]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.equal(await prisma.rentalContract.count(), 1);
      assert.equal(await prisma.odometerReading.count(), 1);
    });

    it("met la zone autorisée sous surveillance pour le véhicule", async () => {
      const zone = await prisma.zone.create({ data: { tenantId: tenantA, name: "Maroc", latitude: 33, longitude: -7, radiusM: 50_000, traccarGeofenceId: 77 } });
      await call(ctx.app, "PUT", `/api/rentals/${rentalId}`, alice, { allowedZoneId: zone.id });
      const res = await pickup();
      assert.equal(res.json.zoneWatched, true);
      assert.equal(await prisma.zoneVehicle.count({ where: { zoneId: zone.id, vehicleId: car } }), 1);
      assert.ok(ctx.traccar.permissions.some((p) => p.deviceId === 1 && p.geofenceId === 77));
    });
  });

  describe("Retour", () => {
    it("termine la location avec le compteur, le carburant et la distance GPS", async () => {
      await pickup({ at: at(-0.5) });
      ctx.traccar.reports.trips = [
        { deviceId: 1, startTime: at(-0.4), endTime: at(-0.2), distance: 310_400, averageSpeed: 20, maxSpeed: 50, duration: 3_600_000 * 5, startLat: 33.5, startLon: -7.6, endLat: 33.6, endLon: -7.5 },
      ];
      const res = await giveBack();
      assert.equal(res.status, 200);
      const r = res.json.rental;
      assert.deepEqual([r.status, r.odometerInKm, r.fuelIn, r.gpsDistanceKm, r.late], ["COMPLETED", 45_320, 4, 310.4, false]);
      assert.deepEqual((await prisma.odometerReading.findMany({ orderBy: { km: "asc" } })).map((x) => x.source), ["RENTAL_OUT", "RENTAL_IN"]);
      // Le véhicule est de nouveau libre.
      assert.equal((await call(ctx.app, "POST", "/api/rentals", alice, { vehicleId: car, customerId: customer, startAt: at(1), endAt: at(10) })).status, 201);

      const report = await download(`/api/rentals/${rentalId}/return-report.pdf`, viewer);
      assert.equal(report.status, 200);
      assert.equal(report.bytes.subarray(0, 5).toString(), "%PDF-");
    });

    it("termine quand même si Traccar est indisponible, sans distance GPS", async () => {
      await pickup({ at: at(-0.5) });
      ctx.traccar.down = true;
      const res = await giveBack();
      assert.equal(res.status, 200);
      assert.equal(res.json.rental.gpsDistanceKm, null);
    });

    it("refuse un retour sans départ, un compteur inférieur au départ, et pas de rapport avant le retour", async () => {
      assert.equal((await giveBack()).json.code, "RENTAL_NOT_ONGOING");
      await pickup({ at: at(-0.5) });
      assert.equal((await download(`/api/rentals/${rentalId}/return-report.pdf`, alice)).status, 404);
      assert.equal((await giveBack({ odometerKm: 44_000 })).json.code, "ODOMETER_DECREASE");
      assert.equal((await giveBack({ at: at(-0.8) })).status, 400);
      assert.equal((await giveBack({}, viewer)).status, 403);
      assert.equal((await giveBack()).status, 200);
      assert.equal((await giveBack()).json.code, "RENTAL_NOT_ONGOING");
    });
  });

  describe("Photos", () => {
    it("stocke une photo réduite, sans métadonnées EXIF, dans un dossier privé", async () => {
      const res = await call(ctx.app, "POST", `/api/rentals/${rentalId}/photos`, agent, { phase: "PICKUP", data: await photoWithExif(), caption: "Rayure porte avant gauche" });
      assert.equal(res.status, 201);
      const row = await prisma.rentalPhoto.findFirstOrThrow();
      assert.match(row.fileName, /^[a-f0-9]{32}\.jpg$/);
      const stored = await readFile(join(RENTAL_FILES_DIR, row.fileName));
      assert.ok(!stored.includes("POSITION-SECRETE"));
      const meta = await sharp(stored).metadata();
      assert.equal(meta.format, "jpeg");
      assert.equal(Math.max(meta.width!, meta.height!), 1920);

      const list = await call(ctx.app, "GET", `/api/rentals/${rentalId}/photos`, viewer);
      assert.equal(list.json.photos[0].caption, "Rayure porte avant gauche");
      assert.ok(!list.body.includes(row.fileName)); // le nom du fichier n'est jamais divulgué
      const file = await download(`/api/rentals/${rentalId}/photos/${row.id}`, viewer);
      assert.equal(file.status, 200);
      assert.equal(file.headers["content-type"], "image/jpeg");
      assert.equal(file.headers["cache-control"], "private, no-store");
      assert.ok(file.bytes.equals(stored));
    });

    it("refuse ce qui n'est pas une image, une étape impossible, et réserve la suppression à l'admin", async () => {
      const text = Buffer.from("<svg onload=alert(1)></svg>").toString("base64");
      assert.equal((await call(ctx.app, "POST", `/api/rentals/${rentalId}/photos`, agent, { phase: "PICKUP", data: text })).status, 400);
      // Signature JPEG mais contenu illisible.
      const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("pas une image")]).toString("base64");
      assert.equal((await call(ctx.app, "POST", `/api/rentals/${rentalId}/photos`, agent, { phase: "PICKUP", data: fake })).status, 400);
      const data = await photoWithExif();
      assert.equal((await call(ctx.app, "POST", `/api/rentals/${rentalId}/photos`, agent, { phase: "RETURN", data })).json.code, "RENTAL_PHOTO_PHASE");
      assert.equal((await call(ctx.app, "POST", `/api/rentals/${rentalId}/photos`, viewer, { phase: "PICKUP", data })).status, 403);

      const id = (await call(ctx.app, "POST", `/api/rentals/${rentalId}/photos`, agent, { phase: "PICKUP", data })).json.photo.id;
      const fileName = (await prisma.rentalPhoto.findUniqueOrThrow({ where: { id } })).fileName;
      assert.equal((await call(ctx.app, "DELETE", `/api/rentals/${rentalId}/photos/${id}`, agent)).status, 403);
      assert.equal((await call(ctx.app, "DELETE", `/api/rentals/${rentalId}/photos/${id}`, alice)).status, 204);
      assert.equal(existsSync(join(RENTAL_FILES_DIR, fileName)), false);
    });

    it("ne sert ni photo ni contrat à un autre client, ni sans session", async () => {
      await pickup();
      const id = (await call(ctx.app, "POST", `/api/rentals/${rentalId}/photos`, agent, { phase: "PICKUP", data: await photoWithExif() })).json.photo.id;
      for (const url of [`/api/rentals/${rentalId}/photos/${id}`, `/api/rentals/${rentalId}/contract.pdf`, `/api/rentals/${rentalId}/photos`]) {
        assert.equal((await download(url, bob)).status, 404, url);
        assert.equal((await download(url, {})).status, 401, url);
      }
      assert.equal((await call(ctx.app, "POST", `/api/rentals/${rentalId}/pickup`, bob, { odometerKm: 1, fuelLevel: 1 })).status, 404);
      assert.equal((await call(ctx.app, "DELETE", `/api/rentals/${rentalId}/photos/${id}`, bob)).status, 404);
    });
  });

  describe("Conditions générales", () => {
    it("sont modifiables par l'admin seulement", async () => {
      assert.equal((await call(ctx.app, "PUT", "/api/tenant/rental-settings", agent, { rentalTerms: "x" })).status, 403);
      assert.equal((await call(ctx.app, "PUT", "/api/tenant/rental-settings", alice, { rentalTerms: "Le véhicule est rendu propre." })).status, 200);
      assert.equal((await call(ctx.app, "GET", "/api/tenant/rental-settings", viewer)).json.rentalTerms, "Le véhicule est rendu propre.");
      assert.equal((await call(ctx.app, "GET", "/api/tenant/rental-settings", bob)).json.rentalTerms, null);
    });
  });

  describe("Alertes", () => {
    it("signale une fois un retour en retard, et de nouveau après une prolongation dépassée", async () => {
      await pickup({ at: at(-0.5) });
      const ctxTask = (hours: number) => ({ now: new Date(Date.now() + hours * 3_600_000), log });
      await overdueRentalsTask(ctxTask(1)); // pas encore en retard (fin à +47 h)
      assert.equal(await prisma.event.count(), 0);
      await overdueRentalsTask(ctxTask(48));
      await overdueRentalsTask(ctxTask(49));
      const events = await prisma.event.findMany();
      assert.equal(events.length, 1);
      assert.equal(events[0]!.type, "RENTAL_OVERDUE");
      assert.equal(events[0]!.rentalId, rentalId);
      assert.match(events[0]!.message!, /^Retour en retard : le véhicule était attendu le /);

      await prisma.rental.update({ where: { id: rentalId }, data: { endAt: new Date(Date.now() + 60 * 3_600_000) } });
      await overdueRentalsTask(ctxTask(50));
      assert.equal(await prisma.event.count(), 1);
      await overdueRentalsTask(ctxTask(61));
      assert.equal(await prisma.event.count(), 2);
    });

    it("signale un véhicule qui roule sans location en cours, une fois par jour, sauf en indisponibilité", async () => {
      const now = new Date();
      const moving = () => {
        ctx.traccar.positions = [position({ deviceId: 1, speed: 30, fixTime: new Date(now.getTime() - 60_000).toISOString(), attributes: { motion: true } })];
      };
      // À l'arrêt, contact coupé : rien.
      ctx.traccar.positions = [position({ deviceId: 1, speed: 0, fixTime: now.toISOString(), attributes: { motion: false, ignition: false } })];
      await unauthorizedUseTask({ now, log });
      assert.equal(await prisma.event.count(), 0);

      moving();
      await unauthorizedUseTask({ now, log });
      await unauthorizedUseTask({ now: new Date(now.getTime() + 5 * 60_000), log });
      const events = await prisma.event.findMany();
      assert.equal(events.length, 1);
      assert.equal(events[0]!.type, "RENTAL_UNAUTHORIZED_USE");

      // Location en cours : usage normal.
      await prisma.event.deleteMany();
      await pickup({ at: at(-0.5) });
      await unauthorizedUseTask({ now: new Date(now.getTime() + 86_400_000), log });
      assert.equal(await prisma.event.count(), 0);
    });

    it("n'alerte pas pour un véhicule immobilisé pour entretien, ni sur une position ancienne", async () => {
      const now = new Date();
      ctx.traccar.positions = [position({ deviceId: 1, speed: 30, fixTime: new Date(now.getTime() - 3_600_000).toISOString(), attributes: { motion: true } })];
      await unauthorizedUseTask({ now, log });
      assert.equal(await prisma.event.count(), 0);

      ctx.traccar.positions = [position({ deviceId: 1, speed: 30, fixTime: now.toISOString(), attributes: { motion: true } })];
      await call(ctx.app, "POST", `/api/vehicles/${car}/unavailabilities`, alice, { startAt: at(-100), endAt: at(-2), reason: "OTHER" });
      await prisma.vehicleUnavailability.create({ data: { tenantId: tenantA, vehicleId: car, startAt: new Date(now.getTime() - 3_600_000), reason: "MAINTENANCE", createdBy: "test" } }).catch(() => undefined);
      await unauthorizedUseTask({ now, log });
      assert.equal(await prisma.event.count(), 0);
    });

    it("signale la sortie de la zone autorisée pendant la location", async () => {
      const zone = await prisma.zone.create({ data: { tenantId: tenantA, name: "Maroc", latitude: 33, longitude: -7, radiusM: 50_000, traccarGeofenceId: 77 } });
      await call(ctx.app, "PUT", `/api/rentals/${rentalId}`, alice, { allowedZoneId: zone.id });
      const exit = (id: number) => recordTraccarEvent({ event: { id, type: "geofenceExit", eventTime: new Date().toISOString(), deviceId: 1, geofenceId: 77 }, position: null });

      await exit(1); // location pas encore partie : simple alerte de zone
      assert.deepEqual((await prisma.event.findMany()).map((e) => e.type), ["ZONE_EXIT"]);
      await pickup();
      await exit(2);
      await exit(2); // retransmis par Traccar
      const types = (await prisma.event.findMany({ orderBy: { createdAt: "asc" } })).map((e) => e.type);
      assert.deepEqual(types.sort(), ["RENTAL_ZONE_EXIT", "ZONE_EXIT", "ZONE_EXIT"]);
    });
  });
});
