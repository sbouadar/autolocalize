import { fromNodeHeaders } from "better-auth/node";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { auth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const passwordBody = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});

const meRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", { preHandler: app.requireAuth }, async (request) => {
    const user = request.currentUser!;

    const tenant = user.tenantId
      ? await prisma.tenant.findUnique({
          where: { id: user.tenantId },
          select: {
            id: true,
            slug: true,
            name: true,
            address: true,
            phone: true,
            email: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
          },
        })
      : null;

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      tenant,
    };
  });

  // Changement de mot de passe : vérifie l'actuel, révoque les autres sessions (autres appareils)
  // et renvoie la nouvelle session (cookie sur le web, en-tête set-auth-token sur mobile).
  app.post(
    "/me/password",
    { preHandler: app.requireAuth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = passwordBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.badRequest(`Le nouveau mot de passe doit contenir de ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères`);
      }
      const { currentPassword, newPassword } = parsed.data;
      if (currentPassword === newPassword) return reply.badRequest("Le nouveau mot de passe doit être différent de l'actuel");

      const response = await auth.api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        headers: fromNodeHeaders(request.headers),
        asResponse: true,
      });
      if (!response.ok) {
        // Seule erreur attendue ici : mot de passe actuel incorrect.
        request.log.warn({ status: response.status }, "Changement de mot de passe refusé");
        return reply.code(400).send({ statusCode: 400, error: "Mot de passe actuel incorrect", code: "INVALID_PASSWORD" });
      }

      if (request.currentUser!.mustChangePassword) {
        await prisma.user.update({ where: { id: request.currentUser!.id }, data: { mustChangePassword: false } });
      }

      for (const cookie of response.headers.getSetCookie()) reply.header("set-cookie", cookie);
      const token = response.headers.get("set-auth-token");
      if (token) reply.header("set-auth-token", token);
      return reply.code(204).send();
    },
  );
};

export default meRoutes;
