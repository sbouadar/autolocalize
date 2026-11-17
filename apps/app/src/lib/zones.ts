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
});
export type Zone = z.infer<typeof zoneSchema>;

const zonesResponseSchema = z.object({ canEdit: z.boolean(), zones: z.array(zoneSchema) });
const zoneResponseSchema = z.object({ zone: zoneSchema });

export type ZoneInput = Omit<Zone, "id">;

// Mêmes bornes que l'API.
export const RADIUS_MIN_M = 50;
export const RADIUS_MAX_M = 100_000;
export const DEFAULT_RADIUS_M = 200;

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

/** « 200 m », « 1,5 km ». */
export function formatRadius(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

/** Rayon saisi (en mètres) ; null s'il n'est pas un entier dans les bornes. */
export function parseRadius(text: string): number | null {
  const value = Number(text.trim().replace(/\s/g, ""));
  return Number.isInteger(value) && value >= RADIUS_MIN_M && value <= RADIUS_MAX_M ? value : null;
}
