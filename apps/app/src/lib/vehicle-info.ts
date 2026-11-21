// Fiche du véhicule et compteur kilométrique : PUT /vehicles/:id, GET/POST/DELETE /vehicles/:id/odometer.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";
import { vehicleDetailsSchema, type FuelType, type VehicleDetails } from "./types";
import { VEHICLES_QUERY_KEY } from "./vehicles";

export const FUEL_LABELS: Record<FuelType, string> = {
  GASOLINE: "Essence",
  DIESEL: "Diesel",
  HYBRID: "Hybride",
  ELECTRIC: "Électrique",
  LPG: "GPL",
  OTHER: "Autre",
};

const readingSchema = z.object({
  id: z.string(),
  km: z.number(),
  readAt: z.string(),
  source: z.string(),
});
export type OdometerReading = z.infer<typeof readingSchema>;

export const odometerSchema = z.object({
  lastReading: z.object({ km: z.number(), readAt: z.string(), source: z.string() }).nullable(),
  estimatedKm: z.number().nullable(),
  gpsKmSinceReading: z.number().nullable(),
  partial: z.boolean(),
  unavailableReason: z.enum(["TRACCAR_UNAVAILABLE", "READING_TOO_OLD"]).nullable().catch(null),
  readings: z.array(readingSchema),
});
export type Odometer = z.infer<typeof odometerSchema>;

export const ODOMETER_SOURCE_LABELS: Record<string, string> = {
  MANUAL: "Relevé manuel",
  RENTAL_OUT: "Départ de location",
  RENTAL_IN: "Retour de location",
  MAINTENANCE: "Entretien",
};

const odometerKey = (id: string) => [...VEHICLES_QUERY_KEY, id, "odometer"] as const;

export function useOdometer(id: string) {
  return useQuery({
    queryKey: odometerKey(id),
    queryFn: () => api(`/vehicles/${encodeURIComponent(id)}/odometer`, { schema: odometerSchema }),
    staleTime: 60_000,
  });
}

export function useOdometerActions(id: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: odometerKey(id) });
  const base = `/vehicles/${encodeURIComponent(id)}/odometer`;
  return {
    add: useMutation({
      mutationFn: (km: number) => api(base, { method: "POST", body: { km } }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (readingId: string) => api(`${base}/${encodeURIComponent(readingId)}`, { method: "DELETE" }),
      onSuccess: refresh,
    }),
  };
}

export type VehicleInfoInput = Partial<VehicleDetails & { name: string; plate: string | null }>;

export function useUpdateVehicleInfo(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: VehicleInfoInput) =>
      api(`/vehicles/${encodeURIComponent(id)}`, {
        method: "PUT",
        body,
        schema: z.object({ vehicle: z.object({ id: z.string(), details: vehicleDetailsSchema }) }),
      }),
    // Fiche et liste : le nom et la plaque y figurent aussi.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: VEHICLES_QUERY_KEY }),
  });
}
