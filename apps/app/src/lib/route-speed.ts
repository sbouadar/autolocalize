// Tracé coloré selon la vitesse : du jaune (lent) au rouge foncé (très rapide).
import type { LatLng } from "./map";

export interface SpeedBand {
  /** Borne haute de la tranche (km/h), Infinity pour la dernière. */
  max: number;
  color: string;
  label: string;
}

export const SPEED_BANDS: SpeedBand[] = [
  { max: 30, color: "#E8B400", label: "< 30" },
  { max: 60, color: "#F08C00", label: "30–60" },
  { max: 90, color: "#E0461F", label: "60–90" },
  { max: 120, color: "#B42318", label: "90–120" },
  { max: Infinity, color: "#6B0F0F", label: "> 120" },
];

export function speedColor(kmh: number): string {
  return (SPEED_BANDS.find((b) => kmh < b.max) ?? SPEED_BANDS.at(-1)!).color;
}

export interface SpeedPoint extends LatLng {
  speedKmh?: number;
  fixTime?: string;
}

/** Distance en kilomètres entre deux points (formule de haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export interface SpeedRun {
  coordinates: LatLng[];
  color: string;
}

/**
 * Découpe le tracé en portions d'une même couleur. Vitesse d'un segment : moyenne des vitesses
 * remontées par le traceur aux deux extrémités ; si le traceur ne remonte aucune vitesse (toutes
 * à 0), elle est calculée à partir de la distance et du temps entre les deux positions.
 */
export function speedRuns(points: SpeedPoint[]): SpeedRun[] {
  if (points.length < 2) return [];
  const reported = points.some((p) => (p.speedKmh ?? 0) > 0);
  const runs: SpeedRun[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    let kmh = ((a.speedKmh ?? 0) + (b.speedKmh ?? 0)) / 2;
    if (!reported && a.fixTime && b.fixTime) {
      const hours = (Date.parse(b.fixTime) - Date.parse(a.fixTime)) / 3_600_000;
      kmh = hours > 0 ? distanceKm(a, b) / hours : 0;
    }
    const color = speedColor(kmh);
    const last = runs.at(-1);
    if (last && last.color === color) last.coordinates.push(b);
    else runs.push({ color, coordinates: [a, b] });
  }
  return runs;
}
