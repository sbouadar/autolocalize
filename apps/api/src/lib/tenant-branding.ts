import { z } from "zod";

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Couleur au format #RRGGBB")
  .transform((v) => v.toUpperCase());

/** Texte facultatif : chaîne vide → null (effacement). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

/**
 * Champs de branding modifiables (super-admin et admin du client).
 * strict() : tout champ non prévu (status, slug…) fait échouer la validation.
 */
export const brandingFields = {
  name: z.string().trim().min(1).max(191),
  address: optionalText(500),
  phone: optionalText(32).refine((v) => v == null || /^[0-9+().\s-]{4,32}$/.test(v), "Numéro de téléphone invalide"),
  email: optionalText(191).refine((v) => v == null || z.email().safeParse(v).success, "Adresse e-mail invalide"),
  primaryColor: hexColor,
  secondaryColor: hexColor,
};

export const brandingBody = z.object(brandingFields).partial().strict();
export type BrandingInput = z.infer<typeof brandingBody>;

/** Premier message d'erreur Zod, lisible par l'utilisateur. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Données invalides";
  if (issue.code === "unrecognized_keys") return `Champ non modifiable : ${issue.keys.join(", ")}`;
  const field = issue.path.join(".");
  return field ? `${field} : ${issue.message}` : issue.message;
}

export const tenantPublicSelect = {
  id: true,
  slug: true,
  name: true,
  address: true,
  phone: true,
  email: true,
  logoUrl: true,
  primaryColor: true,
  secondaryColor: true,
} as const;
