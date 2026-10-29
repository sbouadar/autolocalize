import { hashPassword } from "better-auth/crypto";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import type { Role, TenantStatus } from "../src/generated/prisma/enums.js";
import { prisma } from "../src/lib/prisma.js";
import { resetAddressCache } from "../src/lib/addresses.js";
import { resetTraccarCache } from "../src/lib/traccar.js";
import { PUBLIC_URL } from "./env.js";
import { startFakeTraccar, type FakeTraccar } from "./fake-traccar.js";

export const PASSWORD = "mot-de-passe-de-test-1";

export interface TestContext {
  app: FastifyInstance;
  traccar: FakeTraccar;
}

/** Démarre l'API et le faux Traccar ; à appeler dans before(), avec close() dans after(). */
export async function setup(): Promise<TestContext & { close: () => Promise<void> }> {
  const traccar = await startFakeTraccar();
  const app = await buildApp();
  await app.ready();
  return {
    app,
    traccar,
    close: async () => {
      await app.close();
      await traccar.close();
      await prisma.$disconnect();
    },
  };
}

/** Vide toutes les tables (ordre imposé par les clés étrangères) et les caches. */
export async function resetState(ctx: TestContext) {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.commandLog.deleteMany(),
    prisma.pushToken.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.twoFactor.deleteMany(),
    prisma.verification.deleteMany(),
    prisma.vehicle.deleteMany(),
    prisma.user.deleteMany(),
    prisma.tenant.deleteMany(),
  ]);
  ctx.traccar.reset();
  resetTraccarCache();
  resetAddressCache();
}

export async function createTenant(slug: string, overrides: { status?: TenantStatus; name?: string } = {}) {
  return prisma.tenant.create({
    data: { slug, name: overrides.name ?? `Client ${slug}`, status: overrides.status ?? "ACTIVE" },
  });
}

export async function createUser(email: string, role: Role, tenantId: string | null) {
  const id = randomUUID();
  return prisma.user.create({
    data: {
      id,
      email,
      name: email.split("@")[0]!,
      role,
      tenantId,
      emailVerified: true,
      accounts: {
        create: { id: randomUUID(), accountId: id, providerId: "credential", password: await hashPassword(PASSWORD) },
      },
    },
  });
}

/** Connexion par le vrai flux Better Auth ; renvoie les en-têtes à rejouer (cookie de session). */
export async function login(app: FastifyInstance, email: string, password = PASSWORD) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: PUBLIC_URL, "content-type": "application/json" },
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`Connexion impossible (${res.statusCode}) : ${res.body}`);
  const raw = res.headers["set-cookie"];
  const cookies = (Array.isArray(raw) ? raw : [raw ?? ""]).map((c) => c.split(";")[0]).join("; ");
  return { cookie: cookies, origin: PUBLIC_URL };
}

/** Requête JSON authentifiée. */
export async function call(
  app: FastifyInstance,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  headers: Record<string, string> | null,
  payload?: unknown,
) {
  const res = await app.inject({
    method,
    url,
    headers: { ...(headers ?? {}), ...(payload !== undefined && { "content-type": "application/json" }) },
    ...(payload !== undefined && { payload: JSON.stringify(payload) }),
  });
  let json: any = null;
  try {
    json = res.json();
  } catch {
    // corps vide ou non JSON
  }
  return { status: res.statusCode, json, body: res.body, headers: res.headers };
}
