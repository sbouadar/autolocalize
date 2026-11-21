import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { decryptField, encryptField, hashIdentifier, last4, normalizeIdentifier } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { CUSTOMER_RATE_LIMIT, RENTAL_WRITERS, requireRentalsModule } from "../lib/rentals.js";
import { firstIssue } from "../lib/tenant-branding.js";

// Locataires (M5). Accès : admin et agents du client, module location activé. Les numéros de pièce
// d'identité et de permis sont chiffrés en base et masqués dans toutes les réponses, sauf
// GET /customers/:id/identity, journalisé. Ils ne sont jamais écrits dans les logs ni le journal.

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Date invalide")
  .transform((v) => new Date(`${v}T00:00:00Z`))
  .nullable();

/** Numéro de pièce ou de permis : 3 à 40 caractères utiles ; chaîne vide ou null = effacement. */
const identifier = z
  .string()
  .trim()
  .max(64)
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[A-Za-z0-9][A-Za-z0-9\s\-._/]{1,62}[A-Za-z0-9]$/.test(v), "Numéro invalide")
  .refine((v) => v === null || normalizeIdentifier(v).length >= 3, "Numéro trop court");

const fields = {
  kind: z.enum(["PERSON", "COMPANY"]),
  name: z.string().trim().min(1).max(191),
  phone: optionalText(32).refine((v) => v == null || /^[0-9+().\s-]{4,32}$/.test(v), "Numéro de téléphone invalide"),
  email: optionalText(191).refine((v) => v == null || z.email().safeParse(v).success, "Adresse e-mail invalide"),
  address: optionalText(500),
  birthDate: dateOnly,
  idDocumentType: z.enum(["NATIONAL_ID", "PASSPORT", "RESIDENCE_PERMIT", "OTHER"]).nullable(),
  idDocumentNumber: identifier,
  licenseNumber: identifier,
  licenseExpiresOn: dateOnly,
  notes: optionalText(2000),
};

const createBody = z.object(fields).partial().required({ name: true }).strict();
const updateBody = z.object(fields).partial().strict();
const listQuery = z.object({ q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });
const idParam = z.object({ id: z.string().regex(/^[a-z0-9]{1,64}$/) });

const select = {
  id: true,
  kind: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  birthDate: true,
  idDocumentType: true,
  idDocumentLast4: true,
  licenseLast4: true,
  licenseExpiresOn: true,
  anonymizedAt: true,
  notes: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  kind: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  birthDate: Date | null;
  idDocumentType: string | null;
  idDocumentLast4: string | null;
  licenseLast4: string | null;
  licenseExpiresOn: Date | null;
  anonymizedAt: Date | null;
  notes: string | null;
  createdAt: Date;
};

const masked = (tail: string | null) => (tail ? `••••${tail}` : null);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function publicCustomer(row: Row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    birthDate: day(row.birthDate),
    idDocumentType: row.idDocumentType,
    idDocumentMasked: masked(row.idDocumentLast4),
    licenseMasked: masked(row.licenseLast4),
    licenseExpiresOn: day(row.licenseExpiresOn),
    anonymized: row.anonymizedAt !== null,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

type Input = z.infer<typeof updateBody>;

/** Champs à écrire : les numéros en clair deviennent valeur chiffrée + 4 derniers caractères + empreinte. */
function toData(input: Input) {
  const { idDocumentNumber, licenseNumber, ...rest } = input;
  return {
    ...rest,
    ...(idDocumentNumber !== undefined && {
      idDocumentEnc: idDocumentNumber ? encryptField(idDocumentNumber) : null,
      idDocumentLast4: idDocumentNumber ? last4(idDocumentNumber) : null,
      idDocumentHash: idDocumentNumber ? hashIdentifier(idDocumentNumber) : null,
    }),
    ...(licenseNumber !== undefined && {
      licenseNumberEnc: licenseNumber ? encryptField(licenseNumber) : null,
      licenseLast4: licenseNumber ? last4(licenseNumber) : null,
    }),
  };
}

/** Noms des champs modifiés seulement : jamais de valeur personnelle dans le journal. */
const changedFields = (input: Input) => ({ fields: Object.keys(input).sort() });

const customerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);
  app.addHook("preHandler", app.requireRole(...RENTAL_WRITERS));
  app.addHook("preHandler", requireRentalsModule);

  const tenantOf = (request: FastifyRequest) => request.currentUser!.tenantId!;

  const findOwned = async (request: FastifyRequest) => {
    const parsed = idParam.safeParse(request.params);
    return parsed.success ? prisma.customer.findFirst({ where: { id: parsed.data.id, tenantId: tenantOf(request) }, select }) : null;
  };

  /** Autre locataire du client portant ce numéro de pièce (doublon). */
  const duplicateOf = async (tenantId: string, number: string | null | undefined, exceptId?: string) =>
    number
      ? prisma.customer.findFirst({
          where: { tenantId, idDocumentHash: hashIdentifier(number), ...(exceptId && { id: { not: exceptId } }) },
          select: { id: true, name: true },
        })
      : null;

  const duplicateReply = (reply: FastifyReply, existing: { id: string; name: string }) =>
    reply.code(409).send({
      statusCode: 409,
      error: `Ce numéro de pièce est déjà enregistré pour ${existing.name}`,
      code: "CUSTOMER_DUPLICATE",
      customerId: existing.id,
    });

  // Recherche par nom ou téléphone (contient), ou par numéro de pièce exact (via son empreinte).
  app.get("/customers", { config: CUSTOMER_RATE_LIMIT }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.badRequest("Paramètres invalides");
    const { q, limit } = parsed.data;
    const rows = await prisma.customer.findMany({
      where: {
        tenantId: tenantOf(request),
        ...(q && {
          OR: [
            { name: { contains: q } },
            { phone: { contains: q } },
            ...(normalizeIdentifier(q).length >= 3 ? [{ idDocumentHash: hashIdentifier(q) }] : []),
          ],
        }),
      },
      select,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit,
    });
    return { customers: rows.map(publicCustomer) };
  });

  app.post("/customers", { config: CUSTOMER_RATE_LIMIT }, async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    // Le message d'erreur ne reprend jamais la valeur saisie (firstIssue : champ + règle).
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = tenantOf(request);
    const existing = await duplicateOf(tenantId, parsed.data.idDocumentNumber);
    if (existing) return duplicateReply(reply, existing);

    const row = await prisma.customer.create({ data: { ...toData(parsed.data), name: parsed.data.name, tenantId }, select });
    await audit(request, "customer.create", { tenantId, targetId: row.id, details: changedFields(parsed.data) });
    return reply.code(201).send({ customer: publicCustomer(row) });
  });

  app.get("/customers/:id", { config: CUSTOMER_RATE_LIMIT }, async (request, reply) => {
    const row = await findOwned(request);
    if (!row) return reply.notFound();
    return { customer: publicCustomer(row) };
  });

  app.put("/customers/:id", { config: CUSTOMER_RATE_LIMIT }, async (request, reply) => {
    const row = await findOwned(request);
    if (!row) return reply.notFound();
    if (row.anonymizedAt) return reply.conflict("Ce locataire a été anonymisé : il ne peut plus être modifié");
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = tenantOf(request);
    const existing = await duplicateOf(tenantId, parsed.data.idDocumentNumber, row.id);
    if (existing) return duplicateReply(reply, existing);

    const updated = await prisma.customer.update({ where: { id: row.id }, data: toData(parsed.data), select });
    await audit(request, "customer.update", { tenantId, targetId: row.id, details: changedFields(parsed.data) });
    return { customer: publicCustomer(updated) };
  });

  // Numéros complets : jamais mis en cache, chaque consultation est journalisée.
  app.get("/customers/:id/identity", { config: CUSTOMER_RATE_LIMIT }, async (request, reply) => {
    const parsed = idParam.safeParse(request.params);
    const row = parsed.success
      ? await prisma.customer.findFirst({
          where: { id: parsed.data.id, tenantId: tenantOf(request) },
          select: { id: true, idDocumentEnc: true, licenseNumberEnc: true },
        })
      : null;
    if (!row) return reply.notFound();
    await audit(request, "customer.identity.view", { tenantId: tenantOf(request), targetId: row.id });
    reply.header("Cache-Control", "no-store");
    return {
      idDocumentNumber: row.idDocumentEnc ? decryptField(row.idDocumentEnc) : null,
      licenseNumber: row.licenseNumberEnc ? decryptField(row.licenseNumberEnc) : null,
    };
  });

  // Droit à l'effacement : nom, coordonnées et numéros effacés ; les locations restent.
  app.post("/customers/:id/anonymize", { preHandler: app.requireRole("TENANT_ADMIN") }, async (request, reply) => {
    const row = await findOwned(request);
    if (!row) return reply.notFound();
    if (row.anonymizedAt) return { customer: publicCustomer(row) };
    const tenantId = tenantOf(request);
    if (await prisma.rental.findFirst({ where: { customerId: row.id, status: { in: ["RESERVED", "ONGOING"] } }, select: { id: true } })) {
      return reply.code(409).send({
        statusCode: 409,
        error: "Ce locataire a une location en cours ou réservée : terminez-la ou annulez-la d'abord",
        code: "CUSTOMER_HAS_ACTIVE_RENTAL",
      });
    }
    const updated = await prisma.customer.update({
      where: { id: row.id },
      data: {
        name: "Client anonymisé",
        phone: null,
        email: null,
        address: null,
        birthDate: null,
        idDocumentType: null,
        idDocumentEnc: null,
        idDocumentLast4: null,
        idDocumentHash: null,
        licenseNumberEnc: null,
        licenseLast4: null,
        licenseExpiresOn: null,
        notes: null,
        anonymizedAt: new Date(),
      },
      select,
    });
    await audit(request, "customer.anonymize", { tenantId, targetId: row.id });
    return { customer: publicCustomer(updated) };
  });
};

export default customerRoutes;
