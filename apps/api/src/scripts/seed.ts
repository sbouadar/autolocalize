// Données initiales : un super-admin, un client de démonstration, son admin et le traceur de test.
// Idempotent : peut être relancé sans créer de doublons.
// En prod : docker compose exec -e SEED_...=... api node dist/scripts/seed.js
//
// Variables requises : SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD,
//                      SEED_DEMO_ADMIN_EMAIL, SEED_DEMO_ADMIN_PASSWORD
// Optionnelle : SEED_DEMO_TRACCAR_DEVICE_ID (défaut : 1, le traceur GPS1)

import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import type { Role } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable manquante : ${name}`);
  return value;
}

async function upsertUser(params: {
  email: string;
  password: string;
  name: string;
  role: Role;
  tenantId: string | null;
}) {
  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  if (existing) return existing;

  const id = randomUUID();
  return prisma.user.create({
    data: {
      id,
      email: params.email,
      name: params.name,
      role: params.role,
      tenantId: params.tenantId,
      emailVerified: true,
      // Compte « credential » de Better Auth : c'est lui qui porte le mot de passe haché.
      accounts: {
        create: {
          id: randomUUID(),
          accountId: id,
          providerId: "credential",
          password: await hashPassword(params.password),
        },
      },
    },
  });
}

async function main() {
  const superAdmin = await upsertUser({
    email: required("SEED_SUPERADMIN_EMAIL"),
    password: required("SEED_SUPERADMIN_PASSWORD"),
    name: "Super admin",
    role: "SUPER_ADMIN",
    tenantId: null,
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo" },
    update: {},
    create: {
      slug: "demo",
      name: "Démo Transport",
      address: "1 rue de la Démo, 75001 Paris",
      phone: "+33 1 00 00 00 00",
    },
  });

  const demoAdmin = await upsertUser({
    email: required("SEED_DEMO_ADMIN_EMAIL"),
    password: required("SEED_DEMO_ADMIN_PASSWORD"),
    name: "Admin Démo",
    role: "TENANT_ADMIN",
    tenantId: tenant.id,
  });

  const deviceId = Number(process.env.SEED_DEMO_TRACCAR_DEVICE_ID ?? 1);
  await prisma.vehicle.upsert({
    where: { traccarDeviceId: deviceId },
    update: {},
    create: { tenantId: tenant.id, traccarDeviceId: deviceId, name: "GPS1" },
  });

  console.log(`Super-admin : ${superAdmin.email}`);
  console.log(`Client « ${tenant.name} » (/login/${tenant.slug}), admin : ${demoAdmin.email}`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
