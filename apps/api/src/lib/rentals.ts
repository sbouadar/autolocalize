import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";

// Module location (M5, M6) : garde d'accès et règles communes aux locataires et aux réservations.

/** Rôles d'un client ; le super-admin doit passer par « Se connecter en tant que ». */
export const RENTAL_READERS = ["TENANT_ADMIN", "AGENT", "VIEWER"] as const;
export const RENTAL_WRITERS = ["TENANT_ADMIN", "AGENT"] as const;

/** Lecture de masse des locataires = signal d'extraction : limite propre à ces routes. */
export const CUSTOMER_RATE_LIMIT = { rateLimit: { max: 60, timeWindow: "1 minute" } };

/**
 * preHandler (après requireAuth et requireRole) : le module location doit être activé pour le
 * client. Sinon 404, comme si ces routes n'existaient pas.
 */
export async function requireRentalsModule(request: FastifyRequest, reply: FastifyReply) {
  const tenantId = request.currentUser?.tenantId;
  const tenant = tenantId
    ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { rentalsEnabled: true } })
    : null;
  if (!tenant?.rentalsEnabled) return reply.notFound();
}

/** Statuts qui occupent le véhicule. */
export const ACTIVE_RENTAL_STATUSES = ["RESERVED", "ONGOING"] as const;

export type Conflict = { code: "RENTAL_OVERLAP" | "VEHICLE_UNAVAILABLE"; message: string } | null;

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Conflit d'une période avec les réservations et les indisponibilités du véhicule. À appeler dans
 * une transaction qui a verrouillé la ligne du véhicule (lockVehicle) : MySQL n'a pas de contrainte
 * d'exclusion, c'est ce verrou qui empêche deux réservations simultanées de se chevaucher.
 */
export async function findConflict(
  tx: Tx,
  vehicleId: string,
  startAt: Date,
  endAt: Date,
  exceptRentalId?: string,
): Promise<Conflict> {
  const rental = await tx.rental.findFirst({
    where: {
      vehicleId,
      status: { in: [...ACTIVE_RENTAL_STATUSES] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(exceptRentalId && { id: { not: exceptRentalId } }),
    },
    select: { id: true },
  });
  if (rental) return { code: "RENTAL_OVERLAP", message: "Ce véhicule est déjà réservé sur cette période" };
  const unavailable = await tx.vehicleUnavailability.findFirst({
    where: { vehicleId, startAt: { lt: endAt }, OR: [{ endAt: null }, { endAt: { gt: startAt } }] },
    select: { id: true },
  });
  if (unavailable) return { code: "VEHICLE_UNAVAILABLE", message: "Ce véhicule est indisponible sur cette période" };
  return null;
}

/** Verrouille la ligne du véhicule jusqu'à la fin de la transaction. */
export async function lockVehicle(tx: Tx, vehicleId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM vehicles WHERE id = ${vehicleId} FOR UPDATE`;
}
