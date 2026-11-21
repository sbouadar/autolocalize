import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";

export type AuditAction =
  | "tenant.create"
  | "tenant.update"
  | "tenant.logo.set"
  | "tenant.logo.remove"
  | "tenant.password.reset"
  | "vehicle.assign"
  | "vehicle.update"
  | "vehicle.details.update"
  | "odometer.create"
  | "odometer.delete"
  | "vehicle.unassign"
  | "branding.update"
  | "zone.create"
  | "zone.update"
  | "zone.delete"
  | "impersonation.start"
  | "impersonation.stop";

/**
 * Trace une action d'administration. Ne jamais y mettre de secret (mot de passe, jeton) :
 * details ne contient que des champs métier.
 */
export async function audit(
  request: FastifyRequest,
  action: AuditAction,
  target: { tenantId?: string | null; targetId?: string | null; details?: Record<string, unknown> },
) {
  await prisma.auditLog.create({
    data: {
      actorId: request.currentUser!.id,
      action,
      tenantId: target.tenantId ?? null,
      targetId: target.targetId ?? null,
      details: target.details ? JSON.stringify(target.details) : null,
      ipAddress: request.ip,
    },
  });
}
