import { hashPassword } from "better-auth/crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { generateTemporaryPassword, resetToTemporaryPassword } from "../lib/passwords.js";
import { prisma } from "../lib/prisma.js";
import { firstIssue } from "../lib/tenant-branding.js";

// Comptes du client, gérés par son admin (M2) : création avec mot de passe provisoire, rôle,
// réinitialisation, désactivation. Le client vient toujours de la session, jamais de la requête.

export const MAX_USERS_PER_TENANT = 20;

const tenantRole = z.enum(["TENANT_ADMIN", "AGENT", "VIEWER"]);

const createBody = z
  .object({
    name: z.string().trim().min(1).max(191),
    email: z.email().max(191).transform((e) => e.toLowerCase()),
    role: tenantRole,
  })
  .strict();

const updateBody = z
  .object({ name: z.string().trim().min(1).max(191), role: tenantRole })
  .partial()
  .strict();

const idParam = z.object({ id: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/) });

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  mustChangePassword: true,
  disabledAt: true,
  createdAt: true,
} as const;

function conflict(reply: FastifyReply, code: string, error: string) {
  return reply.code(409).send({ statusCode: 409, error, code });
}

/** Réponse contenant un mot de passe provisoire : jamais mise en cache. */
function noStore(reply: FastifyReply) {
  reply.header("Cache-Control", "no-store");
}

/** Compte du client connecté ; celui d'un autre client (ou le super-admin) est traité comme inexistant. */
async function findOwnUser(request: FastifyRequest) {
  const parsed = idParam.safeParse(request.params);
  if (!parsed.success) return null;
  return prisma.user.findFirst({
    where: { id: parsed.data.id, tenantId: request.currentUser!.tenantId! },
    select: userSelect,
  });
}

/** Nombre d'admins actifs du client, en dehors du compte donné. */
function otherActiveAdmins(tenantId: string, userId: string) {
  return prisma.user.count({ where: { tenantId, role: "TENANT_ADMIN", disabledAt: null, id: { not: userId } } });
}

const tenantUserRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);
  app.addHook("preHandler", app.requireRole("TENANT_ADMIN"));

  app.get("/tenant/users", async (request) => {
    const users = await prisma.user.findMany({
      where: { tenantId: request.currentUser!.tenantId! },
      select: userSelect,
      orderBy: [{ createdAt: "asc" }],
    });
    return { users, limit: MAX_USERS_PER_TENANT, currentUserId: request.currentUser!.id };
  });

  app.post("/tenant/users", async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = request.currentUser!.tenantId!;
    const { name, email, role } = parsed.data;

    if ((await prisma.user.count({ where: { tenantId } })) >= MAX_USERS_PER_TENANT) {
      return conflict(reply, "USER_LIMIT", `${MAX_USERS_PER_TENANT} comptes au plus par client`);
    }
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      return conflict(reply, "EMAIL_TAKEN", "Cette adresse e-mail a déjà un compte");
    }

    const temporaryPassword = generateTemporaryPassword();
    const id = randomUUID();
    let user;
    try {
      user = await prisma.user.create({
        data: {
          id,
          name,
          email,
          role,
          tenantId,
          emailVerified: true,
          mustChangePassword: true,
          accounts: {
            create: { id: randomUUID(), accountId: id, providerId: "credential", password: await hashPassword(temporaryPassword) },
          },
        },
        select: userSelect,
      });
    } catch (err) {
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
        return conflict(reply, "EMAIL_TAKEN", "Cette adresse e-mail a déjà un compte");
      }
      throw err;
    }
    await audit(request, "tenant.user.create", { tenantId, targetId: id, details: { email, role } });
    noStore(reply);
    return reply.code(201).send({ user, temporaryPassword });
  });

  app.put("/tenant/users/:id", async (request, reply) => {
    const user = await findOwnUser(request);
    if (!user) return reply.notFound();
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = request.currentUser!.tenantId!;
    const { role } = parsed.data;

    if (role && role !== user.role) {
      if (user.id === request.currentUser!.id) {
        return conflict(reply, "SELF_ROLE", "Vous ne pouvez pas changer votre propre rôle");
      }
      if (user.role === "TENANT_ADMIN" && !user.disabledAt && (await otherActiveAdmins(tenantId, user.id)) === 0) {
        return conflict(reply, "LAST_ADMIN", "Il doit rester au moins un administrateur actif");
      }
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data: parsed.data, select: userSelect });
    await audit(request, "tenant.user.update", { tenantId, targetId: user.id, details: parsed.data });
    return { user: updated };
  });

  app.post("/tenant/users/:id/reset-password", async (request, reply) => {
    const user = await findOwnUser(request);
    if (!user) return reply.notFound();
    const temporaryPassword = await resetToTemporaryPassword(user.id);
    await audit(request, "tenant.user.password.reset", {
      tenantId: request.currentUser!.tenantId,
      targetId: user.id,
      details: { email: user.email },
    });
    noStore(reply);
    return { email: user.email, temporaryPassword };
  });

  app.post("/tenant/users/:id/disable", async (request, reply) => {
    const user = await findOwnUser(request);
    if (!user) return reply.notFound();
    const tenantId = request.currentUser!.tenantId!;
    if (user.id === request.currentUser!.id) {
      return conflict(reply, "SELF_DISABLE", "Vous ne pouvez pas désactiver votre propre compte");
    }
    if (user.disabledAt) return { user };
    if (user.role === "TENANT_ADMIN" && (await otherActiveAdmins(tenantId, user.id)) === 0) {
      return conflict(reply, "LAST_ADMIN", "Il doit rester au moins un administrateur actif");
    }

    const [updated] = await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() }, select: userSelect }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);
    await audit(request, "tenant.user.disable", { tenantId, targetId: user.id, details: { email: user.email } });
    return { user: updated };
  });

  app.post("/tenant/users/:id/enable", async (request, reply) => {
    const user = await findOwnUser(request);
    if (!user) return reply.notFound();
    if (!user.disabledAt) return { user };
    const updated = await prisma.user.update({ where: { id: user.id }, data: { disabledAt: null }, select: userSelect });
    await audit(request, "tenant.user.enable", {
      tenantId: request.currentUser!.tenantId,
      targetId: user.id,
      details: { email: user.email },
    });
    return { user: updated };
  });
};

export default tenantUserRoutes;
