// Schéma du véhicule vu de dessus pour l'état des lieux : même dessin que
// apps/api/src/lib/car-diagram.ts (contrat PDF). Un impact est une position relative (x, y de 0 à 1).
import { z } from "zod";

export const DIAGRAM_RATIO = 2; // hauteur = 2 × largeur (200 × 400 unités)

const PATHS: { d: string; fill?: string; width: number }[] = [
  { d: "M24 74 h12 v44 h-12 Z M164 74 h12 v44 h-12 Z M24 282 h12 v44 h-12 Z M164 282 h12 v44 h-12 Z", fill: "#141414", width: 2.5 },
  { d: "M44 34 Q46 12 76 9 L124 9 Q154 12 156 34 L163 118 L163 318 Q163 384 128 391 L72 391 Q37 384 37 318 L37 118 Z", fill: "#FFFFFF", width: 2.5 },
  { d: "M50 112 Q100 90 150 112 L142 152 Q100 142 58 152 Z", width: 2.5 },
  { d: "M58 300 Q100 310 142 300 L148 338 Q100 352 52 338 Z", width: 2.5 },
  { d: "M62 160 L138 160 L138 292 L62 292 Z", width: 1.5 },
  { d: "M37 214 L60 214 M140 214 L163 214 M37 160 L50 152 M163 160 L150 152", width: 1.5 },
  { d: "M37 126 L22 120 L22 136 L37 140 Z M163 126 L178 120 L178 136 L163 140 Z", width: 2.5 },
  { d: "M54 18 L74 14 L74 24 L52 28 Z M146 18 L126 14 L126 24 L148 28 Z M48 380 L68 383 L68 389 L50 386 Z M152 380 L132 383 L132 389 L150 386 Z", width: 1.5 },
];

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 400" width="200" height="400">${PATHS.map(
  (p) => `<path d="${p.d}" fill="${p.fill ?? "none"}" stroke="#141414" stroke-width="${p.width}" stroke-linejoin="round" stroke-linecap="round"/>`,
).join("")}</svg>`;

/** Image du schéma (SVG en data URI), affichée par expo-image. */
export const CAR_DIAGRAM_URI = `data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`;

export const damageTypeSchema = z.enum(["SCRATCH", "DENT", "BROKEN", "OTHER"]);
export type DamageType = z.infer<typeof damageTypeSchema>;
export const DAMAGE_LABELS: Record<DamageType, string> = { SCRATCH: "Rayure", DENT: "Choc / bosse", BROKEN: "Cassé / fissuré", OTHER: "Autre" };
export const DAMAGE_COLORS: Record<DamageType, string> = { SCRATCH: "#D97706", DENT: "#B42318", BROKEN: "#7C3AED", OTHER: "#475569" };
export const MAX_DAMAGES = 30;

export const damageSchema = z.object({
  x: z.number(),
  y: z.number(),
  type: damageTypeSchema.catch("OTHER"),
  note: z.string().nullable().optional().default(null),
});
export type Damage = z.infer<typeof damageSchema>;

/** Position touchée (en points dans la vue de largeur `width`) → impact, bornes comprises. */
export function damageAt(locationX: number, locationY: number, width: number, type: DamageType): Damage {
  const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 1000) / 1000));
  return { x: clamp(locationX / width), y: clamp(locationY / (width * DIAGRAM_RATIO)), type, note: null };
}

/** Impacts du retour absents au départ (même règle que le PDF : même type, à moins de 5 %). */
export function newDamages(out: Damage[], back: Damage[]): Set<number> {
  const fresh = new Set<number>();
  back.forEach((d, i) => {
    if (!out.some((o) => o.type === d.type && Math.hypot(o.x - d.x, (o.y - d.y) * 2) < 0.05)) fresh.add(i);
  });
  return fresh;
}
