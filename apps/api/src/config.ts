import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PUBLIC_URL: z.url(),
  DATABASE_URL: z.string().startsWith("mysql://"),
  BETTER_AUTH_SECRET: z.string().min(32),
  TRACCAR_URL: z.url(),
  TRACCAR_TOKEN: z.string().min(1),
  // Dossier des logos des clients (volume Docker en production).
  LOGO_DIR: z.string().min(1).default("data/logos"),
  // Développement uniquement : origines autorisées en plus de PUBLIC_URL (ex. l'app Expo web sur
  // http://localhost:8081). Vide en production, où l'app et l'API partagent la même origine.
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((o) => o.trim()).filter(Boolean) : [])),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // On n'affiche que les noms des variables en erreur, jamais leur valeur.
  const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(`Configuration invalide : ${fields}`);
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === "production";
