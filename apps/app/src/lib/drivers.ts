// Conducteurs et affectations (M8, module conducteurs). Voir apps/api/src/routes/drivers.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";
import { periodQuery, periodRange, type PeriodKey } from "./period";

const nullableString = z.string().nullable();

export const driverSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: nullableString,
  email: nullableString,
  licenseNumber: nullableString,
  licenseExpiresOn: nullableString,
  notes: nullableString,
  active: z.boolean(),
  currentVehicle: z.object({ id: z.string(), name: z.string(), plate: nullableString, since: z.string() }).nullable(),
});
export type Driver = z.infer<typeof driverSchema>;

export const assignmentSchema = z.object({
  id: z.string(),
  startAt: z.string(),
  endAt: nullableString,
  driver: z.object({ id: z.string(), name: z.string() }),
  vehicle: z.object({ id: z.string(), name: z.string(), plate: nullableString }),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export interface DriverInput {
  name?: string;
  phone?: string | null;
  email?: string | null;
  licenseNumber?: string | null;
  licenseExpiresOn?: string | null;
  notes?: string | null;
  active?: boolean;
}

const DRIVERS_KEY = ["drivers"] as const;
const driverResponse = z.object({ driver: driverSchema });

export function useDrivers(includeInactive = false) {
  return useQuery({
    queryKey: [...DRIVERS_KEY, "list", includeInactive],
    queryFn: () => api(`/drivers${includeInactive ? "?includeInactive=true" : ""}`, { schema: z.object({ drivers: z.array(driverSchema) }) }),
    staleTime: 30_000,
  });
}

export function useDriver(id: string) {
  return useQuery({
    queryKey: [...DRIVERS_KEY, id],
    queryFn: () => api(`/drivers/${encodeURIComponent(id)}`, { schema: z.object({ driver: driverSchema, assignments: z.array(assignmentSchema) }) }),
  });
}

const activitySchema = z.object({
  liveDataAvailable: z.boolean(),
  trips: z.number(),
  distanceKm: z.number(),
  drivingMs: z.number(),
  maxSpeedKmh: z.number(),
  alerts: z.record(z.string(), z.number()),
  segments: z.array(
    z.object({ vehicleId: z.string(), vehicleName: z.string(), from: z.string(), to: z.string(), trips: z.number().nullable(), distanceKm: z.number().nullable() }),
  ),
});
export type DriverActivity = z.infer<typeof activitySchema>;

/** Activité du conducteur sur une période (bornes recalculées à chaque chargement). */
export function useDriverActivity(id: string, period: PeriodKey) {
  return useQuery({
    queryKey: [...DRIVERS_KEY, id, "activity", period],
    queryFn: () => api(`/drivers/${encodeURIComponent(id)}/activity?${periodQuery(periodRange(period))}`, { schema: activitySchema }),
    staleTime: 60_000,
  });
}

export function useDriverActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: DRIVERS_KEY });
  return {
    create: useMutation({
      mutationFn: (body: DriverInput) => api("/drivers", { method: "POST", body, schema: driverResponse }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: DriverInput }) => api(`/drivers/${encodeURIComponent(id)}`, { method: "PUT", body, schema: driverResponse }),
      onSuccess: refresh,
    }),
    remove: (id: string) => api(`/drivers/${encodeURIComponent(id)}`, { method: "DELETE" }).then(refresh),
  };
}

export function useVehicleDriver(vehicleId: string) {
  return useQuery({
    queryKey: [...DRIVERS_KEY, "vehicle", vehicleId],
    queryFn: () =>
      api(`/vehicles/${encodeURIComponent(vehicleId)}/driver`, { schema: z.object({ current: assignmentSchema.nullable(), assignments: z.array(assignmentSchema) }) }),
  });
}

export function useAssignDriver(vehicleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { driverId: string | null; at?: string }) => api(`/vehicles/${encodeURIComponent(vehicleId)}/driver`, { method: "POST", body }),
    onSuccess: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: DRIVERS_KEY }), queryClient.invalidateQueries({ queryKey: ["vehicles", vehicleId] })]),
  });
}
