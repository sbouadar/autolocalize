import { createHash, randomBytes } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import { firstIssue } from "../lib/tenant-branding.js";
import { knotsToKmh, traccar } from "../lib/traccar.js";

// Liens de partage temporaires (M10) : la position d'un véhicule, visible sans compte, le temps
// choisi. Création et révocation : admin et agents. Page publique : nom du véhicule et dernière
// position, rien d'autre (ni plaque, ni historique, ni client).

const DURATION_MIN_HOURS = 1;
const DURATION_MAX_HOURS = 7 * 24;
const ACTIVE_PER_VEHICLE = 20;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const createBody = z
  .object({
    durationHours: z.number().int().min(DURATION_MIN_HOURS).max(DURATION_MAX_HOURS),
    label: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .strict();
const idParam = z.object({ id: z.string().regex(/^[a-z0-9]{1,64}$/) });

const linkSelect = { id: true, label: true, expiresAt: true, revokedAt: true, createdAt: true } as const;
const publicLink = (l: { expiresAt: Date; revokedAt: Date | null } & Record<string, unknown>, now = new Date()) => ({
  ...l,
  active: !l.revokedAt && l.expiresAt > now,
});

export const shareLinkRoutes: FastifyPluginAsync = async (app) => {
  const writers = [app.requireAuth, app.requireRole("TENANT_ADMIN", "AGENT")];
  const tenantOf = (request: FastifyRequest) => request.currentUser!.tenantId!;
  const ownedVehicle = async (request: FastifyRequest) => {
    const parsed = idParam.safeParse(request.params);
    return parsed.success ? prisma.vehicle.findFirst({ where: { id: parsed.data.id, tenantId: tenantOf(request) }, select: { id: true } }) : null;
  };

  // Liens actifs et des 7 derniers jours (sans le jeton, qui n'est connu qu'à la création).
  app.get("/vehicles/:id/share-links", { preHandler: writers }, async (request, reply) => {
    const vehicle = await ownedVehicle(request);
    if (!vehicle) return reply.notFound();
    const rows = await prisma.shareLink.findMany({
      where: { vehicleId: vehicle.id, expiresAt: { gt: new Date(Date.now() - 7 * 86_400_000) } },
      select: linkSelect,
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const now = new Date();
    return { links: rows.map((l) => publicLink(l, now)) };
  });

  app.post("/vehicles/:id/share-links", { preHandler: writers, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const vehicle = await ownedVehicle(request);
    if (!vehicle) return reply.notFound();
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const now = new Date();
    const active = await prisma.shareLink.count({ where: { vehicleId: vehicle.id, revokedAt: null, expiresAt: { gt: now } } });
    if (active >= ACTIVE_PER_VEHICLE) return reply.conflict(`${ACTIVE_PER_VEHICLE} liens actifs au plus par véhicule : révoquez-en un`);
    const token = randomBytes(32).toString("base64url");
    const row = await prisma.shareLink.create({
      data: {
        tenantId: tenantOf(request),
        vehicleId: vehicle.id,
        tokenHash: hashToken(token),
        label: parsed.data.label ?? null,
        expiresAt: new Date(now.getTime() + parsed.data.durationHours * 3_600_000),
        createdBy: request.currentUser!.id,
      },
      select: linkSelect,
    });
    await audit(request, "share.create", { tenantId: tenantOf(request), targetId: row.id, details: { vehicleId: vehicle.id, hours: parsed.data.durationHours } });
    // Le jeton n'est renvoyé qu'ici : jamais mis en cache.
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send({ link: publicLink(row, now), token, path: `/share/${token}` });
  });

  app.delete("/share-links/:id", { preHandler: writers }, async (request, reply) => {
    const parsed = idParam.safeParse(request.params);
    const link = parsed.success ? await prisma.shareLink.findFirst({ where: { id: parsed.data.id, tenantId: tenantOf(request) }, select: { id: true, vehicleId: true, revokedAt: true } }) : null;
    if (!link) return reply.notFound();
    if (!link.revokedAt) await prisma.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
    await audit(request, "share.revoke", { tenantId: tenantOf(request), targetId: link.id, details: { vehicleId: link.vehicleId } });
    return reply.code(204).send();
  });
};

// Page publique du lien. Même 404 pour un jeton inconnu, expiré, révoqué ou d'un client suspendu.
export const publicShareRoutes: FastifyPluginAsync = async (app) => {
  app.get("/public/share/:token", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    const token = (request.params as { token?: string }).token ?? "";
    if (!TOKEN_FORMAT.test(token)) return reply.notFound();
    const link = await prisma.shareLink.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { expiresAt: true, revokedAt: true, tenant: { select: { status: true } }, vehicle: { select: { name: true, traccarDeviceId: true } } },
    });
    const now = new Date();
    if (!link || link.revokedAt || link.expiresAt <= now || link.tenant.status !== "ACTIVE") return reply.notFound();

    let position = null;
    let online: boolean | null = null;
    try {
      const [device] = await traccar.getDevices([link.vehicle.traccarDeviceId]);
      if (device) {
        online = device.status === "online";
        const [p] = await traccar.getPositions([device.positionId]);
        // Position invalide au point 0,0 (traceur GT06) : pas de position plutôt qu'un point en mer.
        if (p && !(p.latitude === 0 && p.longitude === 0)) {
          position = { latitude: p.latitude, longitude: p.longitude, speedKmh: knotsToKmh(p.speed), course: p.course, fixTime: p.fixTime };
        }
      }
    } catch (err) {
      request.log.error({ err }, "Échec de l'appel à Traccar (lien de partage)");
      return reply.serviceUnavailable("Position momentanément indisponible");
    }
    return { vehicleName: link.vehicle.name, online, position, expiresAt: link.expiresAt.toISOString() };
  });
};
