import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { firstIssue } from "../lib/tenant-branding.js";

// Appareils de l'utilisateur pour les notifications push (jeton Expo). Le jeton n'est pas un secret
// d'accès : il permet seulement d'envoyer une notification à cet appareil.

const tokenSchema = z
  .string()
  .max(255)
  .regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/, "Jeton de notification invalide");
const registerBody = z.object({ token: tokenSchema, platform: z.enum(["IOS", "ANDROID"]) }).strict();
const removeBody = z.object({ token: tokenSchema }).strict();
const TOKENS_PER_USER = 10;

const pushTokenRoutes: FastifyPluginAsync = async (app) => {
  app.post("/me/push-tokens", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = registerBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const userId = request.currentUser!.id;
    // Un appareil passé d'un compte à un autre ne reçoit plus que les alertes du dernier.
    await prisma.pushToken.upsert({
      where: { token: parsed.data.token },
      create: { userId, token: parsed.data.token, platform: parsed.data.platform },
      update: { userId, platform: parsed.data.platform, lastSeenAt: new Date() },
    });
    // Au-delà de 10 appareils, les plus anciens sont oubliés.
    const extra = await prisma.pushToken.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, skip: TOKENS_PER_USER, select: { id: true } });
    if (extra.length) await prisma.pushToken.deleteMany({ where: { id: { in: extra.map((t) => t.id) } } });
    return reply.code(204).send();
  });

  app.post("/me/push-tokens/remove", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = removeBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    await prisma.pushToken.deleteMany({ where: { token: parsed.data.token, userId: request.currentUser!.id } });
    return reply.code(204).send();
  });
};

export default pushTokenRoutes;
