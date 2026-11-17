import type { FastifyBaseLogger } from "fastify";
import { prisma } from "./prisma.js";
import { traccar } from "./traccar.js";

/**
 * Groupe Traccar du client, créé au premier besoin (traceur affecté, zone créée). Deux créations
 * simultanées peuvent produire deux groupes : seul le premier enregistré est retenu, l'autre reste vide.
 */
export async function ensureTenantGroup(
  tenant: { id: string; slug: string; name: string; traccarGroupId: number | null },
  log: FastifyBaseLogger,
): Promise<number> {
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
