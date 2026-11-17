// Zones d'un client : GET/POST /zones, PUT/DELETE /zones/:id (voir apps/api/src/routes/zones.ts).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";

export const zoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  radiusM: z.number(),
  /** Couleur d'affichage, attribuée par l'API à la création. */
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).catch("#2563EB"),
  /** Véhicules surveillés : eux seuls déclenchent une alerte en entrant dans la zone ou en en sortant. */
  vehicleIds: z.array(z.string()).default([]),
});
export type Zone = z.infer<typeof zoneSchema>;

const zonesResponseSchema = z.object({ canEdit: z.boolean(), zones: z.array(zoneSchema) });
const zoneResponseSchema = z.object({ zone: zoneSchema });

export type ZoneInput = Omit<Zone, "id" | "color">;

// Mêmes bornes que l'API.
export const RADIUS_MIN_M = 50;
export const RADIUS_MAX_M = 100_000;
export const DEFAULT_RADIUS_M = 1_000;
/** Un véhicule est surveillé par 5 zones au plus. */
export const ZONES_PER_VEHICLE = 5;

export const ZONES_QUERY_KEY = ["zones"] as const;

export function useZones() {
  return useQuery({
    queryKey: ZONES_QUERY_KEY,
    queryFn: () => api("/zones", { schema: zonesResponseSchema }),
    staleTime: 60_000,
  });
}

/** Création (sans id) ou modification (avec id) d'une zone. */
export function useSaveZone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ZoneInput & { id?: string }) =>
      id
        ? api(`/zones/${encodeURIComponent(id)}`, { method: "PUT", body, schema: zoneResponseSchema })
        : api("/zones", { method: "POST", body, schema: zoneResponseSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ZONES_QUERY_KEY }),
  });
}

export function useDeleteZone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/zones/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ZONES_QUERY_KEY }),
  });
}

const km = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** « 20 km », « 0,2 km ». */
export function formatRadius(meters: number): string {
  return `${km.format(meters / 1000)} km`;
}

/** Rayon en kilomètres tel qu'on le saisit : « 20 », « 0,2 ». */
export function radiusToKmText(meters: number): string {
  return km.format(meters / 1000).replace(/\s/g, "");
}

/** Rayon saisi en kilomètres (virgule ou point) → mètres ; null s'il est hors bornes ou illisible. */
export function parseRadiusKm(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const meters = Math.round(Number(cleaned) * 1000);
  return meters >= RADIUS_MIN_M && meters <= RADIUS_MAX_M ? meters : null;
}
