import { fromNodeHeaders } from "better-auth/node";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { auth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import type { Role } from "../generated/prisma/enums.js";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser: CurrentUser | null;
  }
  interface FastifyInstance {
    /** preHandler : exige une session valide et un tenant actif. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler : exige l'un des rôles donnés (à placer après requireAuth). */
    requireRole: (...roles: Role[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app) => {
  app.decorateRequest("currentUser", null);

  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) return reply.unauthorized();

    // On relit le rôle et le tenant en base : ce sont eux qui font foi, pas la session en cache.
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        tenant: { select: { status: true } },
      },
    });
    if (!user) return reply.unauthorized();

    if (user.role !== "SUPER_ADMIN") {
      if (!user.tenantId || !user.tenant) return reply.forbidden("Compte non rattaché à un client");
      if (user.tenant.status !== "ACTIVE") return reply.forbidden("Abonnement suspendu");
    }

    request.currentUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
    };
  });

  app.decorate(
    "requireRole",
    (...roles: Role[]) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        if (!request.currentUser || !roles.includes(request.currentUser.role)) {
          return reply.forbidden();
        }
      },
  );
});
