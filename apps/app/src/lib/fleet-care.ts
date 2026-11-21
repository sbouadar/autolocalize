// Échéances administratives et indisponibilités des véhicules (voir apps/api/src/routes/deadlines.ts
// et unavailabilities.ts).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";

export const deadlineTypeSchema = z.enum(["INSURANCE", "TECHNICAL_INSPECTION", "ROAD_TAX", "REGISTRATION", "OTHER"]);
export type DeadlineType = z.infer<typeof deadlineTypeSchema>;

export const DEADLINE_TYPE_LABELS: Record<DeadlineType, string> = {
  INSURANCE: "Assurance",
  TECHNICAL_INSPECTION: "Visite technique",
  ROAD_TAX: "Vignette",
  REGISTRATION: "Carte grise",
  OTHER: "Autre",
};

export const deadlineSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  vehicleName: z.string(),
  vehiclePlate: z.string().nullable(),
  type: deadlineTypeSchema.catch("OTHER"),
  label: z.string().nullable(),
  expiresOn: z.string(),
  reference: z.string().nullable(),
  warnDaysBefore: z.number(),
  notes: z.string().nullable(),
  daysLeft: z.number(),
  status: z.enum(["OK", "WARNING", "EXPIRED"]).catch("OK"),
});
export type Deadline = z.infer<typeof deadlineSchema>;

const deadlinesSchema = z.object({ deadlines: z.array(deadlineSchema) });

export function deadlineName(d: Pick<Deadline, "type" | "label">): string {
  return d.type === "OTHER" && d.label ? d.label : DEADLINE_TYPE_LABELS[d.type];
}

/** « expire dans 12 jours », « expire aujourd'hui », « expirée depuis 3 jours ». */
export function deadlineDelay(daysLeft: number): string {
  if (daysLeft < 0) return `expirée depuis ${-daysLeft} jour${daysLeft < -1 ? "s" : ""}`;
  if (daysLeft === 0) return "expire aujourd’hui";
  return `expire dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}`;
}

const DEADLINES_KEY = ["deadlines"] as const;

export function useVehicleDeadlines(vehicleId: string) {
  return useQuery({
    queryKey: [...DEADLINES_KEY, "vehicle", vehicleId],
    queryFn: () => api(`/vehicles/${encodeURIComponent(vehicleId)}/deadlines`, { schema: deadlinesSchema }),
  });
}

/** Échéances dépassées ou à renouveler dans ce délai, pour toute la flotte. */
export function useDueDeadlines(withinDays = 30) {
  return useQuery({
    queryKey: [...DEADLINES_KEY, "due", withinDays],
    queryFn: () => api(`/deadlines?dueWithinDays=${withinDays}`, { schema: deadlinesSchema }),
    staleTime: 5 * 60_000,
  });
}

export interface DeadlineInput {
  type: DeadlineType;
  label: string | null;
  expiresOn: string;
  reference: string | null;
}

export function useDeadlineActions(vehicleId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: DEADLINES_KEY });
  return {
    create: useMutation({
      mutationFn: (body: DeadlineInput) =>
        api(`/vehicles/${encodeURIComponent(vehicleId)}/deadlines`, { method: "POST", body }),
      onSuccess: refresh,
    }),
    renew: (id: string, expiresOn: string) =>
      api(`/deadlines/${encodeURIComponent(id)}`, { method: "PUT", body: { expiresOn } }).then(refresh),
    remove: (id: string) => api(`/deadlines/${encodeURIComponent(id)}`, { method: "DELETE" }).then(refresh),
  };
}

export const unavailabilityReasonSchema = z.enum(["MAINTENANCE", "REPAIR", "ACCIDENT", "OTHER"]);
export type UnavailabilityReason = z.infer<typeof unavailabilityReasonSchema>;

export const UNAVAILABILITY_REASON_LABELS: Record<UnavailabilityReason, string> = {
  MAINTENANCE: "Entretien",
  REPAIR: "Réparation",
  ACCIDENT: "Accident",
  OTHER: "Autre",
};

export const unavailabilitySchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  vehicleName: z.string(),
  vehiclePlate: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string().nullable(),
  reason: unavailabilityReasonSchema.catch("OTHER"),
  notes: z.string().nullable(),
  current: z.boolean(),
  past: z.boolean().default(false),
});
export type Unavailability = z.infer<typeof unavailabilitySchema>;

const unavailabilitiesSchema = z.object({ unavailabilities: z.array(unavailabilitySchema) });
const UNAVAILABILITIES_KEY = ["unavailabilities"] as const;

export function useVehicleUnavailabilities(vehicleId: string) {
  return useQuery({
    queryKey: [...UNAVAILABILITIES_KEY, "vehicle", vehicleId],
    queryFn: () => api(`/vehicles/${encodeURIComponent(vehicleId)}/unavailabilities`, { schema: unavailabilitiesSchema }),
  });
}

export function useCurrentUnavailabilities() {
  return useQuery({
    queryKey: [...UNAVAILABILITIES_KEY, "current"],
    queryFn: () => api("/unavailabilities/current", { schema: unavailabilitiesSchema }),
    staleTime: 60_000,
  });
}

export interface UnavailabilityInput {
  startAt: string;
  endAt: string | null;
  reason: UnavailabilityReason;
  notes: string | null;
}

export function useUnavailabilityActions(vehicleId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: UNAVAILABILITIES_KEY });
  return {
    create: useMutation({
      mutationFn: (body: UnavailabilityInput) =>
        api(`/vehicles/${encodeURIComponent(vehicleId)}/unavailabilities`, { method: "POST", body }),
      onSuccess: refresh,
    }),
    /** Met fin maintenant à une indisponibilité en cours. */
    end: (id: string) =>
      api(`/unavailabilities/${encodeURIComponent(id)}`, { method: "PUT", body: { endAt: new Date().toISOString() } }).then(refresh),
    remove: (id: string) => api(`/unavailabilities/${encodeURIComponent(id)}`, { method: "DELETE" }).then(refresh),
  };
}
