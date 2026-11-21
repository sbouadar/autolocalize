import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { decryptField, encryptField, hashIdentifier, normalizeIdentifier } from "../src/lib/crypto.js";
import { prisma } from "../src/lib/prisma.js";
import { call, createTenant, createUser, login, resetState, setup } from "./helpers.js";

const ctx = await setup();
after(() => ctx.close());

const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const CIN = "BK 123-456";

describe("M5 : locataires et réservations", () => {
  let tenantA: string;
  let tenantB: string;
  let alice: Record<string, string>;
  let agent: Record<string, string>;
  let viewer: Record<string, string>;
  let bob: Record<string, string>;
  let root: Record<string, string>;
  let car: string;
  let van: string;
  let theirs: string;

  beforeEach(async () => {
    await resetState(ctx);
    tenantA = (await createTenant("alpha")).id;
    tenantB = (await createTenant("bravo")).id;
    await prisma.tenant.updateMany({ where: { id: { in: [tenantA, tenantB] } }, data: { rentalsEnabled: true } });
    await createUser("alice@alpha.test", "TENANT_ADMIN", tenantA);
    await createUser("ali@alpha.test", "AGENT", tenantA);
    await createUser("vic@alpha.test", "VIEWER", tenantA);
    await createUser("bob@bravo.test", "TENANT_ADMIN", tenantB);
    await createUser("root@plateforme.test", "SUPER_ADMIN", null);
    car = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 1, name: "Clio", plate: "1-A-1" } })).id;
    van = (await prisma.vehicle.create({ data: { tenantId: tenantA, traccarDeviceId: 2, name: "Master" } })).id;
    theirs = (await prisma.vehicle.create({ data: { tenantId: tenantB, traccarDeviceId: 3, name: "B" } })).id;
    alice = await login(ctx.app, "alice@alpha.test");
    agent = await login(ctx.app, "ali@alpha.test");
    viewer = await login(ctx.app, "vic@alpha.test");
    bob = await login(ctx.app, "bob@bravo.test");
    root = await login(ctx.app, "root@plateforme.test");
  });

  const newCustomer = async (headers = alice, body: Record<string, unknown> = {}) =>
    call(ctx.app, "POST", "/api/customers", headers, { name: "Karim Alaoui", phone: "+212600000001", ...body });

  describe("Chiffrement", () => {
    it("chiffre avec un IV différent à chaque fois et détecte une valeur altérée", () => {
      const a = encryptField(CIN);
      const b = encryptField(CIN);
      assert.notEqual(a, b);
      assert.match(a, /^v1:/);
      assert.ok(!a.includes("123"));
      assert.equal(decryptField(a), CIN);
      const tampered = a.slice(0, -4) + (a.endsWith("AAAA") ? "BBBB" : "AAAA");
      assert.throws(() => decryptField(tampered));
    });

    it("donne la même empreinte à un numéro saisi différemment", () => {
      assert.equal(normalizeIdentifier(" bk123.456 "), "BK123456");
      assert.equal(hashIdentifier("bk123456"), hashIdentifier(CIN));
      assert.notEqual(hashIdentifier("BK123457"), hashIdentifier(CIN));
      assert.match(hashIdentifier(CIN), /^[0-9a-f]{64}$/);
    });
  });

  describe("Locataires", () => {
    it("enregistre les numéros chiffrés et ne les renvoie que masqués", async () => {
      const res = await newCustomer(agent, { idDocumentType: "NATIONAL_ID", idDocumentNumber: CIN, licenseNumber: "12/345678", birthDate: "1990-05-17" });
      assert.equal(res.status, 201);
      assert.equal(res.json.customer.idDocumentMasked, "••••3456");
      assert.equal(res.json.customer.licenseMasked, "••••5678");
      assert.equal(res.json.customer.birthDate, "1990-05-17");
      assert.ok(!res.body.includes("BK"));

      // En base : aucun numéro en clair, dans aucune colonne.
      const row = await prisma.customer.findUniqueOrThrow({ where: { id: res.json.customer.id } });
      const stored = JSON.stringify(row);
      assert.ok(!stored.includes("BK123") && !stored.includes("BK 123") && !stored.includes("345678"));
      assert.match(row.idDocumentEnc!, /^v1:/);

      // Listes et lecture : toujours masqués.
      const list = await call(ctx.app, "GET", "/api/customers", alice);
      assert.ok(!list.body.includes("BK") && !list.body.includes("345678"));
      assert.equal((await call(ctx.app, "GET", `/api/customers/${row.id}`, alice)).json.customer.idDocumentMasked, "••••3456");

      // Journal : noms de champs seulement.
      const logs = JSON.stringify(await prisma.auditLog.findMany());
      assert.ok(!logs.includes("BK") && !logs.includes("345678") && !logs.includes("Karim"));
    });

    it("ne donne le numéro complet que sur demande, sans cache, et journalise chaque consultation", async () => {
      const id = (await newCustomer(alice, { idDocumentNumber: CIN })).json.customer.id;
      const res = await call(ctx.app, "GET", `/api/customers/${id}/identity`, agent);
      assert.equal(res.status, 200);
      assert.equal(res.json.idDocumentNumber, CIN);
      assert.equal(res.json.licenseNumber, null);
      assert.equal(res.headers["cache-control"], "no-store");
      await call(ctx.app, "GET", `/api/customers/${id}/identity`, alice);
      assert.equal(await prisma.auditLog.count({ where: { action: "customer.identity.view", targetId: id } }), 2);
    });

    it("retrouve un locataire par nom, téléphone ou numéro de pièce exact, et refuse un doublon", async () => {
      const id = (await newCustomer(alice, { idDocumentNumber: CIN })).json.customer.id;
      await newCustomer(alice, { name: "Société Atlas", kind: "COMPANY", phone: null });
      const names = async (q: string) =>
        (await call(ctx.app, "GET", `/api/customers?q=${encodeURIComponent(q)}`, alice)).json.customers.map((c: { name: string }) => c.name);
      assert.deepEqual(await names("alao"), ["Karim Alaoui"]);
      assert.deepEqual(await names("0000001"), ["Karim Alaoui"]);
      assert.deepEqual(await names("bk123456"), ["Karim Alaoui"]);
      assert.deepEqual(await names("BK123"), []); // pas de recherche partielle sur un numéro chiffré
      assert.equal((await names("")).length, 2);

      const dup = await newCustomer(alice, { name: "Autre", idDocumentNumber: "bk-123456" });
      assert.equal(dup.status, 409);
      assert.equal(dup.json.code, "CUSTOMER_DUPLICATE");
      assert.equal(dup.json.customerId, id);
      // Le même numéro chez un autre client n'est pas un doublon.
      assert.equal((await newCustomer(bob, { idDocumentNumber: CIN })).status, 201);
    });

    it("réserve les locataires à l'admin et aux agents, et cloisonne les clients", async () => {
      const id = (await newCustomer(alice, { idDocumentNumber: CIN })).json.customer.id;
      for (const h of [viewer, root]) {
        assert.equal((await call(ctx.app, "GET", "/api/customers", h)).status, 403);
        assert.equal((await call(ctx.app, "GET", `/api/customers/${id}/identity`, h)).status, 403);
      }
      for (const [method, path, body] of [
        ["GET", `/api/customers/${id}`, undefined],
        ["GET", `/api/customers/${id}/identity`, undefined],
        ["PUT", `/api/customers/${id}`, { name: "X" }],
        ["POST", `/api/customers/${id}/anonymize`, {}],
      ] as const) {
        assert.equal((await call(ctx.app, method, path, bob, body)).status, 404, path);
      }
      assert.deepEqual((await call(ctx.app, "GET", "/api/customers", bob)).json.customers, []);
    });

    it("valide les saisies sans jamais renvoyer le numéro dans l'erreur", async () => {
      for (const body of [{ name: "" }, { email: "pas-un-mail" }, { birthDate: "17/05/1990" }, { idDocumentNumber: "!" }, { tenantId: tenantB }]) {
        const res = await newCustomer(alice, body);
        assert.equal(res.status, 400, JSON.stringify(body));
      }
      const bad = await newCustomer(alice, { idDocumentNumber: "SECRET<>999" });
      assert.equal(bad.status, 400);
      assert.ok(!bad.body.includes("SECRET"));
    });

    it("anonymise un locataire, sauf pendant une location, et garde ses locations", async () => {
      const id = (await newCustomer(alice, { idDocumentNumber: CIN, email: "k@test.ma" })).json.customer.id;
      const rental = await call(ctx.app, "POST", "/api/rentals", alice, { vehicleId: car, customerId: id, startAt: at(1), endAt: at(25) });
      assert.equal(rental.status, 201);
      assert.equal((await call(ctx.app, "POST", `/api/customers/${id}/anonymize`, agent, {})).status, 403);
      assert.equal((await call(ctx.app, "POST", `/api/customers/${id}/anonymize`, alice, {})).json.code, "CUSTOMER_HAS_ACTIVE_RENTAL");

      await call(ctx.app, "POST", `/api/rentals/${rental.json.rental.id}/cancel`, alice, {});
      const res = await call(ctx.app, "POST", `/api/customers/${id}/anonymize`, alice, {});
      assert.equal(res.status, 200);
      assert.equal(res.json.customer.name, "Client anonymisé");
      assert.equal(res.json.customer.anonymized, true);
      const row = await prisma.customer.findUniqueOrThrow({ where: { id } });
      assert.equal(row.idDocumentEnc, null);
      assert.equal(row.idDocumentHash, null);
      assert.equal(row.email, null);
      assert.equal((await call(ctx.app, "GET", `/api/rentals/${rental.json.rental.id}`, alice)).json.rental.customerName, "Client anonymisé");
      // Plus modifiable, plus louable.
      assert.equal((await call(ctx.app, "PUT", `/api/customers/${id}`, alice, { name: "Karim" })).status, 409);
      assert.equal((await call(ctx.app, "POST", "/api/rentals", alice, { vehicleId: car, customerId: id, startAt: at(1), endAt: at(2) })).status, 400);
    });
  });

  describe("Réservations", () => {
    let customer: string;
    beforeEach(async () => {
      customer = (await newCustomer()).json.customer.id;
    });
    const book = (body: Record<string, unknown>, headers = alice) =>
      call(ctx.app, "POST", "/api/rentals", headers, { vehicleId: car, customerId: customer, startAt: at(24), endAt: at(72), ...body });

    it("crée une réservation avec prix, caution et devise du client", async () => {
      const res = await book({ price: 1200.5, deposit: 5000, driverName: "Yassine", notes: "Siège bébé" }, agent);
      assert.equal(res.status, 201);
      const r = res.json.rental;
      assert.equal(r.status, "RESERVED");
      assert.equal(r.vehicleName, "Clio");
      assert.equal(r.vehiclePlate, "1-A-1");
      assert.equal(r.customerName, "Karim Alaoui");
      assert.equal(r.price, "1200.50");
      assert.equal(r.deposit, "5000.00");
      assert.equal(r.currency, "MAD");
      assert.equal(r.late, false);
    });

    it("refuse un chevauchement avec une autre réservation, mais accepte des périodes qui se touchent", async () => {
      assert.equal((await book({})).status, 201); // de +24 h à +72 h
      for (const [s, e] of [[30, 40], [10, 30], [60, 100], [10, 100]] as const) {
        const res = await book({ startAt: at(s), endAt: at(e) });
        assert.equal(res.status, 409, `${s}-${e}`);
        assert.equal(res.json.code, "RENTAL_OVERLAP");
      }
      const start = at(24);
      const end = at(72);
      await prisma.rental.deleteMany();
      assert.equal((await book({ startAt: start, endAt: end })).status, 201);
      assert.equal((await book({ startAt: end, endAt: at(96) })).status, 201); // commence quand l'autre finit
      assert.equal((await book({ startAt: at(1), endAt: start })).status, 201); // finit quand l'autre commence
      assert.equal((await book({ vehicleId: van })).status, 201); // un autre véhicule est libre
    });

    it("n'accepte qu'une des deux réservations simultanées du même véhicule", async () => {
      const results = await Promise.all([book({}), book({}), book({}), book({})]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409]);
      assert.equal(await prisma.rental.count(), 1);
    });

    it("refuse une réservation pendant une indisponibilité du véhicule", async () => {
      await call(ctx.app, "POST", `/api/vehicles/${car}/unavailabilities`, alice, { startAt: at(48), reason: "REPAIR" });
      const res = await book({});
      assert.equal(res.status, 409);
      assert.equal(res.json.code, "VEHICLE_UNAVAILABLE");
      assert.equal((await book({ startAt: at(1), endAt: at(47) })).status, 201);
    });

    it("libère le véhicule quand la réservation est annulée", async () => {
      const id = (await book({})).json.rental.id;
      assert.equal((await call(ctx.app, "POST", `/api/rentals/${id}/cancel`, agent, {})).json.rental.status, "CANCELLED");
      assert.equal((await book({})).status, 201);
      // Une location partie ne s'annule pas.
      const other = (await book({ vehicleId: van })).json.rental.id;
      await prisma.rental.update({ where: { id: other }, data: { status: "ONGOING" } });
      assert.equal((await call(ctx.app, "POST", `/api/rentals/${other}/cancel`, alice, {})).json.code, "RENTAL_NOT_CANCELLABLE");
    });

    it("modifie une réservation en revérifiant les chevauchements, et limite les changements après le départ", async () => {
      const first = (await book({})).json.rental.id; // +24 h → +72 h
      const second = (await book({ startAt: at(100), endAt: at(120) })).json.rental.id;
      assert.equal((await call(ctx.app, "PUT", `/api/rentals/${second}`, alice, { startAt: at(60) })).json.code, "RENTAL_OVERLAP");
      // Décaler sa propre réservation n'est pas un chevauchement avec elle-même.
      assert.equal((await call(ctx.app, "PUT", `/api/rentals/${first}`, alice, { endAt: at(80) })).status, 200);
      const moved = await call(ctx.app, "PUT", `/api/rentals/${second}`, alice, { vehicleId: van, price: 300 });
      assert.equal(moved.json.rental.vehicleName, "Master");
      assert.equal(moved.json.rental.price, "300.00");

      await prisma.rental.update({ where: { id: first }, data: { status: "ONGOING" } });
      assert.equal((await call(ctx.app, "PUT", `/api/rentals/${first}`, alice, { vehicleId: van })).json.code, "RENTAL_STARTED");
      assert.equal((await call(ctx.app, "PUT", `/api/rentals/${first}`, alice, { endAt: at(90), notes: "Prolongée" })).status, 200);
      await prisma.rental.update({ where: { id: first }, data: { status: "COMPLETED" } });
      assert.equal((await call(ctx.app, "PUT", `/api/rentals/${first}`, alice, { notes: "x" })).json.code, "RENTAL_CLOSED");
    });

    it("valide la période, le véhicule, le locataire et les montants", async () => {
      for (const body of [
        { startAt: at(10), endAt: at(5) },
        { startAt: at(-48), endAt: at(-24) },
        { startAt: at(1), endAt: at(24 * 400) },
        { vehicleId: theirs },
        { customerId: "inconnu" },
        { price: -1 },
        { price: 10.123 },
        { status: "COMPLETED" },
        { allowedZoneId: "zoneinconnue" },
      ]) {
        assert.equal((await book(body)).status, 400, JSON.stringify(body));
      }
    });

    it("liste les locations d'une période et la disponibilité des véhicules", async () => {
      await book({}); // Clio, +24 h → +72 h
      await call(ctx.app, "POST", `/api/vehicles/${van}/unavailabilities`, alice, { startAt: at(200), endAt: at(220), reason: "MAINTENANCE" });

      const list = await call(ctx.app, "GET", `/api/rentals?from=${encodeURIComponent(at(0))}&to=${encodeURIComponent(at(48))}`, viewer);
      assert.equal(list.json.rentals.length, 1);
      assert.equal((await call(ctx.app, "GET", `/api/rentals?from=${encodeURIComponent(at(80))}`, viewer)).json.rentals.length, 0);
      assert.equal((await call(ctx.app, "GET", `/api/rentals?vehicleId=${van}`, viewer)).json.rentals.length, 0);

      const free = async (from: number, to: number) =>
        (await call(ctx.app, "GET", `/api/vehicles/availability?from=${encodeURIComponent(at(from))}&to=${encodeURIComponent(at(to))}`, viewer)).json.vehicles.map(
          (v: { name: string; available: boolean; reason: string | null }) => [v.name, v.available, v.reason],
        );
      assert.deepEqual(await free(30, 40), [["Clio", false, "RENTED"], ["Master", true, null]]);
      assert.deepEqual(await free(210, 215), [["Clio", true, null], ["Master", false, "UNAVAILABLE"]]);
    });

    it("réserve l'écriture à l'admin et aux agents, et cloisonne les clients", async () => {
      assert.equal((await book({}, viewer)).status, 403);
      const id = (await book({})).json.rental.id;
      assert.equal((await call(ctx.app, "POST", `/api/rentals/${id}/cancel`, viewer, {})).status, 403);
      assert.equal((await call(ctx.app, "GET", `/api/rentals/${id}`, viewer)).status, 200);
      assert.equal((await call(ctx.app, "GET", `/api/rentals/${id}`, bob)).status, 404);
      assert.equal((await call(ctx.app, "PUT", `/api/rentals/${id}`, bob, { notes: "x" })).status, 404);
      assert.equal((await call(ctx.app, "POST", `/api/rentals/${id}/cancel`, bob, {})).status, 404);
      assert.deepEqual((await call(ctx.app, "GET", "/api/rentals", bob)).json.rentals, []);
      // Le locataire d'un autre client n'est pas utilisable.
      const theirCustomer = (await newCustomer(bob)).json.customer.id;
      assert.equal((await book({ customerId: theirCustomer })).status, 400);
      assert.equal((await call(ctx.app, "GET", "/api/rentals", root)).status, 403);
    });

    it("garde la location lisible quand le véhicule est retiré, et empêche de retirer un véhicule loué", async () => {
      const id = (await book({})).json.rental.id;
      const blocked = await call(ctx.app, "DELETE", `/api/admin/vehicles/${car}`, root);
      assert.equal(blocked.status, 409);
      assert.equal(blocked.json.code, "VEHICLE_HAS_ACTIVE_RENTAL");
      await call(ctx.app, "POST", `/api/rentals/${id}/cancel`, alice, {});
      assert.equal((await call(ctx.app, "DELETE", `/api/admin/vehicles/${car}`, root)).status, 204);
      const rental = (await call(ctx.app, "GET", `/api/rentals/${id}`, alice)).json.rental;
      assert.equal(rental.vehicleId, null);
      assert.equal(rental.vehicleName, "Clio");
    });
  });

  it("répond 404 partout quand le module location n'est pas activé pour le client", async () => {
    await prisma.tenant.update({ where: { id: tenantA }, data: { rentalsEnabled: false } });
    for (const path of ["/api/customers", "/api/rentals", `/api/vehicles/availability?from=${encodeURIComponent(at(1))}&to=${encodeURIComponent(at(2))}`]) {
      assert.equal((await call(ctx.app, "GET", path, alice)).status, 404, path);
    }
    assert.equal((await call(ctx.app, "POST", "/api/customers", alice, { name: "X" })).status, 404);
    // Les autres routes du véhicule ne sont pas touchées.
    assert.equal((await call(ctx.app, "GET", `/api/vehicles/${car}/deadlines`, alice)).status, 200);
  });
});
