import { hashPassword } from "better-auth/crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { clearLogo, decodeLogo, LOGO_ERRORS, logoBody, replaceLogo } from "../lib/logos.js";
import { generateTemporaryPassword, resetToTemporaryPassword } from "../lib/passwords.js";
import { prisma } from "../lib/prisma.js";
import { brandingBody, brandingFields, firstIssue } from "../lib/tenant-branding.js";
import { traccar, type TraccarDevice } from "../lib/traccar.js";

// Back-office du super-admin : clients, compte unique de chaque client, traceurs, journal.
// Toutes les routes exigent une session valide ET le rôle SUPER_ADMIN (relu en base à chaque requête).

const RESERVED_SLUGS = new Set(["admin", "api", "app", "login", "public", "www", "traccar"]);

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lettres minuscules, chiffres et tirets uniquement")
  .refine((s) => !RESERVED_SLUGS.has(s), "Identifiant réservé");

const idParam = z.object({ id: z.string().regex(/^[a-z0-9]{1,64}$/) });

const createTenantBody = z
  .object({
    slug,
    name: brandingFields.name,
    address: brandingFields.address.optional(),
    phone: brandingFields.phone.optional(),
    email: brandingFields.email.optional(),
    primaryColor: brandingFields.primaryColor.optional(),
    secondaryColor: brandingFields.secondaryColor.optional(),
    admin: z
      .object({
        name: z.string().trim().min(1).max(191),
        email: z.email().max(191).transform((e) => e.toLowerCase()),
      })
      .strict(),
  })
  .strict();

const updateTenantBody = brandingBody.extend({ status: z.enum(["ACTIVE", "SUSPENDED", "CANCELLED"]).optional() }).strict();

const HISTORY_MAX_YEARS = 5;

/**
 * Début de l'historique visible par le client. Le super-admin l'avance quand le traceur est neuf
 * ou déjà chez ce client ; il ne doit jamais couvrir une période où le traceur était chez un autre.
 */
const historyStartAt = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v))
  .refine((d) => d.getTime() <= Date.now() + 60_000, "La date de début d'historique ne peut pas être dans le futur")
  .refine(
    (d) => d.getTime() >= Date.now() - HISTORY_MAX_YEARS * 365 * 86_400_000,
    `La date de début d'historique ne peut pas remonter à plus de ${HISTORY_MAX_YEARS} ans`,
  );

const assignVehicleBody = z
  .object({
    name: z.string().trim().min(1).max(191),
    plate: z.string().trim().max(32).nullable().optional().transform((v) => (v ? v : null)),
    traccarDeviceId: z.number().int().positive().optional(),
    imei: z.string().trim().regex(/^[0-9A-Za-z]{5,32}$/, "Identifiant de traceur invalide").optional(),
    historyStartAt: historyStartAt.optional(),
  })
  .strict()
  .refine((b) => (b.traccarDeviceId === undefined) !== (b.imei === undefined), {
    message: "Indiquez soit un appareil Traccar existant, soit un IMEI",
  });

const updateVehicleBody = z
  .object({
    name: z.string().trim().min(1).max(191),
    plate: z.string().trim().max(32).nullable().transform((v) => (v ? v : null)),
    historyStartAt,
  })
  .partial()
  .strict();

const auditQuery = z.object({
  tenantId: z.string().regex(/^[a-z0-9]{1,64}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

function parseId(request: FastifyRequest): string | null {
  const parsed = idParam.safeParse(request.params);
  return parsed.success ? parsed.data.id : null;
}

/** Réponse contenant un mot de passe provisoire : jamais mise en cache. */
function noStore(reply: FastifyReply) {
  reply.header("Cache-Control", "no-store");
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/**
 * Groupe Traccar du client, créé au premier traceur affecté. Deux affectations simultanées
 * peuvent créer deux groupes : seul le premier enregistré est retenu, l'autre reste vide.
 */
async function ensureTenantGroup(
  tenant: { id: string; slug: string; name: string; traccarGroupId: number | null },
  log: FastifyRequest["log"],
) {
  if (tenant.traccarGroupId) return tenant.traccarGroupId;
  const group = await traccar.createGroup(`${tenant.name} (${tenant.slug})`);
  const { count } = await prisma.tenant.updateMany({
    where: { id: tenant.id, traccarGroupId: null },
    data: { traccarGroupId: group.id },
  });
  if (count === 1) return group.id;
  const winner = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { traccarGroupId: true } });
  log.warn({ orphanGroupId: group.id }, "Groupe Traccar créé en double (vide, à supprimer dans Traccar)");
  return winner.traccarGroupId!;
}

function deviceSummary(d: TraccarDevice | undefined) {
  return d ? { uniqueId: d.uniqueId, traccarName: d.name, status: d.status, lastUpdate: d.lastUpdate, disabled: d.disabled } : null;
}

const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);
  app.addHook("preHandler", app.requireRole("SUPER_ADMIN"));

  // ─── Clients ───────────────────────────────────────────────────────────────

  app.get("/admin/tenants", async () => {
    const tenants = await prisma.tenant.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        logoUrl: true,
        primaryColor: true,
        createdAt: true,
        _count: { select: { vehicles: true, users: true } },
      },
    });
    return {
      tenants: tenants.map(({ _count, ...t }) => ({ ...t, vehicleCount: _count.vehicles, userCount: _count.users })),
    };
  });

  // Crée le client et son compte unique (admin du client) avec un mot de passe provisoire.
  app.post("/admin/tenants", async (request, reply) => {
    const parsed = createTenantBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const { admin, ...data } = parsed.data;

    if (await prisma.tenant.findUnique({ where: { slug: data.slug }, select: { id: true } })) {
      return reply.conflict("Cet identifiant de client est déjà utilisé");
    }
    if (await prisma.user.findUnique({ where: { email: admin.email }, select: { id: true } })) {
      return reply.conflict("Cette adresse e-mail a déjà un compte");
    }

    const temporaryPassword = generateTemporaryPassword();
    const userId = randomUUID();
    let tenant;
    try {
      tenant = await prisma.tenant.create({
        data: {
          ...data,
          users: {
            create: {
              id: userId,
              name: admin.name,
              email: admin.email,
              role: "TENANT_ADMIN",
              emailVerified: true,
              mustChangePassword: true,
              accounts: {
                create: {
                  id: randomUUID(),
                  accountId: userId,
                  providerId: "credential",
                  password: await hashPassword(temporaryPassword),
                },
              },
            },
          },
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.conflict("Identifiant ou adresse e-mail déjà utilisé");
      throw err;
    }

    await audit(request, "tenant.create", {
      tenantId: tenant.id,
      targetId: tenant.id,
      details: { slug: tenant.slug, name: tenant.name, adminEmail: admin.email },
    });
    noStore(reply);
    return reply.code(201).send({ tenant, admin: { id: userId, email: admin.email, temporaryPassword } });
  });

  app.get("/admin/tenants/:id", async (request, reply) => {
    const id = parseId(request);
    const tenant = id
      ? await prisma.tenant.findUnique({
          where: { id },
          include: {
            users: {
              select: { id: true, name: true, email: true, role: true, mustChangePassword: true, createdAt: true },
              orderBy: { createdAt: "asc" },
            },
            vehicles: {
              select: { id: true, name: true, plate: true, traccarDeviceId: true, historyStartAt: true, createdAt: true },
              orderBy: { name: "asc" },
            },
          },
        })
      : null;
    if (!tenant) return reply.notFound();

    let devices = new Map<number, TraccarDevice>();
    let traccarAvailable = true;
    try {
      devices = new Map((await traccar.listDevices()).map((d) => [d.id, d]));
    } catch (err) {
      request.log.error({ err }, "Traccar indisponible (fiche client)");
      traccarAvailable = false;
    }

    const { users, vehicles, ...rest } = tenant;
    return {
      tenant: rest,
      users,
      traccarAvailable,
      vehicles: vehicles.map((v) => ({ ...v, device: deviceSummary(devices.get(v.traccarDeviceId)) })),
    };
  });

  app.put("/admin/tenants/:id", async (request, reply) => {
    const id = parseId(request);
    if (!id || !(await prisma.tenant.findUnique({ where: { id }, select: { id: true } }))) return reply.notFound();
    const parsed = updateTenantBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));

    const tenant = await prisma.tenant.update({ where: { id }, data: parsed.data });
    await audit(request, "tenant.update", { tenantId: id, targetId: id, details: parsed.data });
    return { tenant };
  });

  app.post("/admin/tenants/:id/logo", { bodyLimit: 1_000_000 }, async (request, reply) => {
    const id = parseId(request);
    if (!id || !(await prisma.tenant.findUnique({ where: { id }, select: { id: true } }))) return reply.notFound();
    const parsed = logoBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(LOGO_ERRORS.too_large);
    const logo = decodeLogo(parsed.data.data);
    if ("error" in logo) return reply.badRequest(LOGO_ERRORS[logo.error]);

    const logoUrl = await replaceLogo(id, logo.bytes, logo.type.ext);
    await audit(request, "tenant.logo.set", { tenantId: id, targetId: id, details: { bytes: logo.bytes.length, type: logo.type.mime } });
    return { logoUrl };
  });

  app.delete("/admin/tenants/:id/logo", async (request, reply) => {
    const id = parseId(request);
    if (!id || !(await prisma.tenant.findUnique({ where: { id }, select: { id: true } }))) return reply.notFound();
    await clearLogo(id);
    await audit(request, "tenant.logo.remove", { tenantId: id, targetId: id });
    return reply.code(204).send();
  });

  // Nouveau mot de passe provisoire pour le compte du client (oubli, départ d'un salarié…).
  app.post("/admin/tenants/:id/reset-password", async (request, reply) => {
    const id = parseId(request);
    const user = id
      ? await prisma.user.findFirst({
          where: { tenantId: id, role: "TENANT_ADMIN" },
          orderBy: { createdAt: "asc" },
          select: { id: true, email: true },
        })
      : null;
    if (!user) return reply.notFound();

    const temporaryPassword = await resetToTemporaryPassword(user.id);
    await audit(request, "tenant.password.reset", { tenantId: id, targetId: user.id, details: { email: user.email } });
    noStore(reply);
    return { email: user.email, temporaryPassword };
  });

  // ─── Traceurs ──────────────────────────────────────────────────────────────

  // Tous les appareils Traccar, avec leur client éventuel : sert à choisir un traceur libre.
  app.get("/admin/devices", async (request, reply) => {
    let devices: TraccarDevice[];
    try {
      devices = await traccar.listDevices();
    } catch (err) {
      request.log.error({ err }, "Traccar indisponible (liste des appareils)");
      return reply.serviceUnavailable("Traccar est momentanément indisponible");
    }
    const vehicles = await prisma.vehicle.findMany({
      select: { id: true, name: true, traccarDeviceId: true, tenant: { select: { id: true, name: true } } },
    });
    const byDevice = new Map(vehicles.map((v) => [v.traccarDeviceId, v]));
    return {
      devices: devices
        .map((d) => {
          const v = byDevice.get(d.id);
          return {
            id: d.id,
            name: d.name,
            uniqueId: d.uniqueId,
            status: d.status,
            lastUpdate: d.lastUpdate,
            disabled: d.disabled,
            assignment: v ? { vehicleId: v.id, vehicleName: v.name, tenantId: v.tenant.id, tenantName: v.tenant.name } : null,
          };
        })
        .sort((a, b) => Number(a.assignment !== null) - Number(b.assignment !== null) || a.name.localeCompare(b.name, "fr")),
    };
  });

  // Affecte un traceur à un client : appareil Traccar existant et libre, ou nouveau par IMEI.
  app.post("/admin/tenants/:id/vehicles", async (request, reply) => {
    const id = parseId(request);
    const tenant = id
      ? await prisma.tenant.findUnique({ where: { id }, select: { id: true, slug: true, name: true, traccarGroupId: true } })
      : null;
    if (!tenant) return reply.notFound();
    const parsed = assignVehicleBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const body = parsed.data;

    let devices: TraccarDevice[];
    let groupId: number;
    try {
      devices = await traccar.listDevices();
      groupId = await ensureTenantGroup(tenant, request.log);
    } catch (err) {
      request.log.error({ err }, "Traccar indisponible (affectation)");
      return reply.serviceUnavailable("Traccar est momentanément indisponible");
    }

    let deviceId: number;
    if (body.imei !== undefined) {
      const existing = devices.find((d) => d.uniqueId === body.imei);
      if (existing) {
        return reply.conflict(`Ce traceur est déjà déclaré dans Traccar (appareil n° ${existing.id}) : choisissez-le dans la liste`);
      }
      try {
        deviceId = (await traccar.createDevice({ name: body.name, uniqueId: body.imei, groupId })).id;
      } catch (err) {
        request.log.error({ err }, "Échec de la création de l'appareil Traccar");
        return reply.serviceUnavailable("Traccar a refusé la création du traceur");
      }
    } else {
      deviceId = body.traccarDeviceId!;
      if (!devices.some((d) => d.id === deviceId)) return reply.notFound("Appareil Traccar introuvable");
    }

    if (await prisma.vehicle.findUnique({ where: { traccarDeviceId: deviceId }, select: { id: true } })) {
      return reply.conflict("Ce traceur est déjà affecté à un véhicule");
    }
    let vehicle;
    try {
      vehicle = await prisma.vehicle.create({
        data: { tenantId: tenant.id, traccarDeviceId: deviceId, name: body.name, plate: body.plate, ...(body.historyStartAt && { historyStartAt: body.historyStartAt }) },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.conflict("Ce traceur est déjà affecté à un véhicule");
      throw err;
    }

    if (body.imei === undefined) {
      try {
        await traccar.setDeviceGroup(deviceId, groupId);
      } catch (err) {
        // Traccar et notre base doivent rester cohérents : on annule l'affectation.
        await prisma.vehicle.delete({ where: { id: vehicle.id } });
        request.log.error({ err }, "Échec du rattachement au groupe Traccar");
        return reply.serviceUnavailable("Traccar est momentanément indisponible");
      }
    }

    await audit(request, "vehicle.assign", {
      tenantId: tenant.id,
      targetId: vehicle.id,
      details: { traccarDeviceId: deviceId, name: vehicle.name, plate: vehicle.plate, created: body.imei !== undefined, historyStartAt: vehicle.historyStartAt.toISOString() },
    });
    return reply.code(201).send({ vehicle });
  });

  app.put("/admin/vehicles/:id", async (request, reply) => {
    const id = parseId(request);
    const existing = id ? await prisma.vehicle.findUnique({ where: { id }, select: { tenantId: true } }) : null;
    if (!existing) return reply.notFound();
    const parsed = updateVehicleBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));

    const vehicle = await prisma.vehicle.update({ where: { id: id! }, data: parsed.data });
    await audit(request, "vehicle.update", { tenantId: existing.tenantId, targetId: id, details: parsed.data });
    return { vehicle };
  });

  // Retire un traceur d'un client : le véhicule disparaît de l'application, l'appareil reste dans Traccar.
  // Le journal des commandes moteur est conservé (lien vidé, nom et traceur gardés en copie).
  app.delete("/admin/vehicles/:id", async (request, reply) => {
    const id = parseId(request);
    const vehicle = id
      ? await prisma.vehicle.findUnique({
          where: { id },
          select: { id: true, tenantId: true, name: true, traccarDeviceId: true },
        })
      : null;
    if (!vehicle) return reply.notFound();

    await prisma.vehicle.delete({ where: { id: vehicle.id } });
    try {
      await traccar.setDeviceGroup(vehicle.traccarDeviceId, 0);
    } catch (err) {
      // Sans conséquence pour l'accès (notre base fait foi) : on le signale seulement.
      request.log.warn({ err }, "Appareil non retiré de son groupe Traccar");
    }
    await audit(request, "vehicle.unassign", {
      tenantId: vehicle.tenantId,
      targetId: vehicle.id,
      details: { traccarDeviceId: vehicle.traccarDeviceId, name: vehicle.name },
    });
    return reply.code(204).send();
  });

  // ─── Journal ───────────────────────────────────────────────────────────────

  app.get("/admin/audit", async (request, reply) => {
    const parsed = auditQuery.safeParse(request.query);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const entries = await prisma.auditLog.findMany({
      where: parsed.data.tenantId ? { tenantId: parsed.data.tenantId } : {},
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit,
      select: {
        id: true,
        action: true,
        tenantId: true,
        targetId: true,
        details: true,
        createdAt: true,
        actor: { select: { email: true } },
      },
    });
    return {
      entries: entries.map(({ actor, details, ...e }) => ({
        ...e,
        actorEmail: actor.email,
        details: details ? (JSON.parse(details) as unknown) : null,
      })),
    };
  });
};

export default adminRoutes;
