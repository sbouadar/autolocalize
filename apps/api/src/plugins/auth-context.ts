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
  mustChangePassword: boolean;
}

/** Routes accessibles avec un mot de passe provisoire (méthode + motif de route Fastify). */
const PASSWORD_CHANGE_ALLOWED = new Set(["GET /api/me", "POST /api/me/password"]);

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
        mustChangePassword: true,
        tenant: { select: { status: true } },
      },
    });
    if (!user) return reply.unauthorized();

    if (user.role !== "SUPER_ADMIN") {
      if (!user.tenantId || !user.tenant) return reply.forbidden("Compte non rattaché à un client");
      if (user.tenant.status !== "ACTIVE") return reply.forbidden("Abonnement suspendu");
    }

    // Mot de passe provisoire : seuls la lecture du profil et le changement de mot de passe passent.
    if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(`${request.method} ${request.routeOptions.url}`)) {
      return reply.code(403).send({
        statusCode: 403,
        error: "Changez votre mot de passe provisoire pour continuer",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }

    request.currentUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      mustChangePassword: user.mustChangePassword,
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
