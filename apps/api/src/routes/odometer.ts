import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { estimateOdometer } from "../lib/odometer.js";
import { prisma } from "../lib/prisma.js";
import { firstIssue } from "../lib/tenant-branding.js";
import { findOwnedVehicle, REPORT_RATE_LIMIT } from "./vehicles.js";

// Compteur kilométrique d'un véhicule : relevés saisis et compteur estimé (dernier relevé + GPS).

const KM_MAX = 2_000_000;
const READINGS_SHOWN = 20;

const createBody = z
  .object({
    km: z.number().int().min(0).max(KM_MAX),
    // Par défaut maintenant ; jamais dans le futur.
    readAt: z.iso
      .datetime({ offset: true })
      .transform((v) => new Date(v))
      .refine((d) => d.getTime() <= Date.now() + 60_000, "La date du relevé ne peut pas être dans le futur")
      .optional(),
  })
  .strict();

const readingParams = z.object({ id: z.string().regex(/^[a-z0-9]{1,64}$/), readingId: z.string().regex(/^[a-z0-9]{1,64}$/) });

const readingSelect = { id: true, km: true, readAt: true, source: true, createdAt: true } as const;

const odometerRoutes: FastifyPluginAsync = async (app) => {
  // Compteur estimé et derniers relevés (tout utilisateur du client).
  app.get("/vehicles/:id/odometer", { preHandler: app.requireAuth, config: REPORT_RATE_LIMIT }, async (request, reply) => {
    const vehicle = await findOwnedVehicle(request);
    if (!vehicle) return reply.notFound();
    const [{ lastReading, estimate }, readings] = await Promise.all([
      estimateOdometer(vehicle, request.log),
      prisma.odometerReading.findMany({
        where: { vehicleId: vehicle.id },
        orderBy: [{ readAt: "desc" }, { createdAt: "desc" }],
        take: READINGS_SHOWN,
        select: readingSelect,
      }),
    ]);
    return {
      lastReading: lastReading ? { km: lastReading.km, readAt: lastReading.readAt, source: lastReading.source } : null,
      ...estimate,
      readings,
    };
  });

  // Relevé manuel (admin ou agent du client). Un compteur ne recule pas : un relevé incohérent avec ceux
  // d'avant ou d'après est refusé (409) ; une erreur de saisie se corrige en supprimant le relevé.
  app.post(
    "/vehicles/:id/odometer",
    { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN", "AGENT")] },
    async (request, reply) => {
      const vehicle = await findOwnedVehicle(request);
      if (!vehicle) return reply.notFound();
      const parsed = createBody.safeParse(request.body);
      if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
      const km = parsed.data.km;
      const readAt = parsed.data.readAt ?? new Date();

      const [before, after] = await Promise.all([
        prisma.odometerReading.findFirst({
          where: { vehicleId: vehicle.id, readAt: { lte: readAt }, km: { gt: km } },
          select: { km: true },
        }),
        prisma.odometerReading.findFirst({
          where: { vehicleId: vehicle.id, readAt: { gt: readAt }, km: { lt: km } },
          select: { km: true },
        }),
      ]);
      if (before || after) {
        return reply.code(409).send({
          statusCode: 409,
          error: before
            ? `Le compteur ne peut pas reculer : un relevé antérieur indique déjà ${before.km} km`
            : `Le compteur ne peut pas reculer : un relevé plus récent indique ${after!.km} km`,
          code: "ODOMETER_DECREASE",
        });
      }

      const reading = await prisma.odometerReading.create({
        data: { tenantId: vehicle.tenantId, vehicleId: vehicle.id, km, readAt, source: "MANUAL", createdBy: request.currentUser!.id },
        select: readingSelect,
      });
      await audit(request, "odometer.create", { tenantId: vehicle.tenantId, targetId: vehicle.id, details: { km, readAt } });
      return reply.code(201).send({ reading });
    },
  );

  // Suppression d'un relevé erroné (admin du client).
  app.delete(
    "/vehicles/:id/odometer/:readingId",
    { preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN")] },
    async (request, reply) => {
      const vehicle = await findOwnedVehicle(request);
      const params = readingParams.safeParse(request.params);
      if (!vehicle || !params.success) return reply.notFound();
      const reading = await prisma.odometerReading.findFirst({
        where: { id: params.data.readingId, vehicleId: vehicle.id },
        select: { id: true, km: true, readAt: true },
      });
      if (!reading) return reply.notFound();
      await prisma.odometerReading.delete({ where: { id: reading.id } });
      await audit(request, "odometer.delete", {
        tenantId: vehicle.tenantId,
        targetId: vehicle.id,
        details: { km: reading.km, readAt: reading.readAt },
      });
      return reply.code(204).send();
    },
  );
};

export default odometerRoutes;
