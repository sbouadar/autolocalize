import { defineConfig, env } from "prisma/config";

// Prisma ne charge plus le fichier .env tout seul.
try {
  process.loadEnvFile();
} catch {
  // pas de .env : les variables viennent de l'environnement (Docker)
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
