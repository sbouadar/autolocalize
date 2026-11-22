import { z } from "zod";

const is32Bytes = (v: string) => Buffer.from(v, "base64").length === 32;

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
  // Secret que Traccar joint à chaque événement transmis (event.forward.header dans traccar.xml).
  // Absent : la réception des événements est désactivée.
  TRACCAR_EVENTS_SECRET: z.string().min(32).optional(),
  // Clés du module location (32 octets en base64, « openssl rand -base64 32 ») : chiffrement des
  // numéros de pièce d'identité et de permis, et empreinte servant à les rechercher. Jamais en base
  // ni dans le dépôt. Absentes ou mal formées : le module location ne peut être activé pour aucun
  // client (une clé mal formée n'empêche pas l'API de démarrer : elle est signalée au démarrage).
  DATA_ENCRYPTION_KEY: z.string().optional(),
  DATA_HASH_KEY: z.string().optional(),
  // Dossier des logos des clients (volume Docker en production).
  LOGO_DIR: z.string().min(1).default("data/logos"),
  // Dossier privé des fichiers de location (photos d'état des lieux, contrats PDF) : volume Docker
  // en production, jamais servi par une route publique.
  RENTAL_FILES_DIR: z.string().min(1).default("data/rental-files"),
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

/** Clés du module location présentes mais inutilisables (pas 32 octets en base64) : noms seulement. */
export const invalidDataKeys = (["DATA_ENCRYPTION_KEY", "DATA_HASH_KEY"] as const).filter((name) => {
  const value = parsed.data[name];
  return value !== undefined && !is32Bytes(value);
});
for (const name of invalidDataKeys) parsed.data[name] = undefined;

export const config = parsed.data;
export const isProduction = config.NODE_ENV === "production";
