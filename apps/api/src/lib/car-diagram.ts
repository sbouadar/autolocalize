import { z } from "zod";

// Schéma du véhicule vu de dessus (avant en haut), pour l'état des lieux. Même dessin que
// apps/app/src/lib/car-diagram.ts : un impact est une position relative (x, y de 0 à 1) sur ce
// schéma de 200 × 400 unités.

export const DIAGRAM_WIDTH = 200;
export const DIAGRAM_HEIGHT = 400;

/** Tracés SVG : roues (pleines), carrosserie (fond blanc), puis détails. */
export const CAR_PATHS: { d: string; fill?: string; width: number }[] = [
  { d: "M24 74 h12 v44 h-12 Z M164 74 h12 v44 h-12 Z M24 282 h12 v44 h-12 Z M164 282 h12 v44 h-12 Z", fill: "#141414", width: 2.5 },
  { d: "M44 34 Q46 12 76 9 L124 9 Q154 12 156 34 L163 118 L163 318 Q163 384 128 391 L72 391 Q37 384 37 318 L37 118 Z", fill: "#FFFFFF", width: 2.5 },
  { d: "M50 112 Q100 90 150 112 L142 152 Q100 142 58 152 Z", width: 2.5 },
  { d: "M58 300 Q100 310 142 300 L148 338 Q100 352 52 338 Z", width: 2.5 },
  { d: "M62 160 L138 160 L138 292 L62 292 Z", width: 1.5 },
  { d: "M37 214 L60 214 M140 214 L163 214 M37 160 L50 152 M163 160 L150 152", width: 1.5 },
  { d: "M37 126 L22 120 L22 136 L37 140 Z M163 126 L178 120 L178 136 L163 140 Z", width: 2.5 },
  { d: "M54 18 L74 14 L74 24 L52 28 Z M146 18 L126 14 L126 24 L148 28 Z M48 380 L68 383 L68 389 L50 386 Z M152 380 L132 383 L132 389 L150 386 Z", width: 1.5 },
];

export const DAMAGE_TYPES = ["SCRATCH", "DENT", "BROKEN", "OTHER"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];
export const DAMAGE_LABELS: Record<DamageType, string> = { SCRATCH: "Rayure", DENT: "Choc / bosse", BROKEN: "Cassé / fissuré", OTHER: "Autre" };
export const DAMAGE_COLORS: Record<DamageType, string> = { SCRATCH: "#D97706", DENT: "#B42318", BROKEN: "#7C3AED", OTHER: "#475569" };

export const MAX_DAMAGES = 30;
export const damageSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    type: z.enum(DAMAGE_TYPES),
    note: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .strict();
export type Damage = z.infer<typeof damageSchema>;
export const damagesSchema = z.array(damageSchema).max(MAX_DAMAGES);

/** Impacts lus en base (JSON) ; une valeur illisible donne une liste vide. */
export function readDamages(value: unknown): Damage[] {
  const parsed = damagesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** Impacts du retour absents au départ (même type, à moins de 5 % de la taille du schéma). */
export function newDamages(out: Damage[], back: Damage[]): Set<number> {
  const fresh = new Set<number>();
  back.forEach((d, i) => {
    const known = out.some((o) => o.type === d.type && Math.hypot(o.x - d.x, (o.y - d.y) * 2) < 0.05);
    if (!known) fresh.add(i);
  });
  return fresh;
}
