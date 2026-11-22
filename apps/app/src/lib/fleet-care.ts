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

// ─── Entretien (voir apps/api/src/routes/maintenance.ts) ─────────────────────

export const maintenanceTypeSchema = z.enum(["OIL_CHANGE", "TIRES", "BRAKES", "TIMING_BELT", "SERVICE", "BATTERY", "AIR_CONDITIONING", "OTHER"]);
export type MaintenanceType = z.infer<typeof maintenanceTypeSchema>;

export const MAINTENANCE_TYPE_LABELS: Record<MaintenanceType, string> = {
  OIL_CHANGE: "Vidange",
  TIRES: "Pneus",
  BRAKES: "Freins",
  TIMING_BELT: "Courroie",
  SERVICE: "Révision",
  BATTERY: "Batterie",
  AIR_CONDITIONING: "Climatisation",
  OTHER: "Autre",
};

export const maintenancePlanSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  vehicleName: z.string(),
  type: maintenanceTypeSchema.catch("OTHER"),
  label: z.string().nullable(),
  intervalKm: z.number().nullable(),
  intervalDays: z.number().nullable(),
  lastDoneAt: z.string().nullable(),
  lastDoneKm: z.number().nullable(),
  currentKm: z.number().nullable(),
  status: z.enum(["OK", "DUE", "OVERDUE", "UNKNOWN"]).catch("UNKNOWN"),
  nextKm: z.number().nullable(),
  kmLeft: z.number().nullable(),
  nextDate: z.string().nullable(),
  daysLeft: z.number().nullable(),
});
export type MaintenancePlan = z.infer<typeof maintenancePlanSchema>;

export function maintenanceName(p: Pick<MaintenancePlan, "type" | "label">): string {
  return p.type === "OTHER" && p.label ? p.label : MAINTENANCE_TYPE_LABELS[p.type];
}

const km = new Intl.NumberFormat("fr-FR");

/** « dans 700 km », « dépassé de 1 200 km », « dans 12 jours »… ; l'échéance la plus pressante en premier. */
export function maintenanceDelay(p: Pick<MaintenancePlan, "status" | "kmLeft" | "daysLeft">): string {
  if (p.status === "UNKNOWN") return "à compléter";
  const parts: string[] = [];
  if (p.kmLeft != null) parts.push(p.kmLeft < 0 ? `dépassé de ${km.format(-p.kmLeft)} km` : `dans ${km.format(p.kmLeft)} km`);
  if (p.daysLeft != null) {
    parts.push(p.daysLeft < 0 ? `en retard de ${-p.daysLeft} jour${p.daysLeft < -1 ? "s" : ""}` : p.daysLeft === 0 ? "aujourd’hui" : `dans ${p.daysLeft} jour${p.daysLeft > 1 ? "s" : ""}`);
  }
  return parts.join(" ou ") || "à compléter";
}

const maintenanceRecordSchema = z.object({
  id: z.string(),
  planId: z.string().nullable(),
  type: maintenanceTypeSchema.catch("OTHER"),
  label: z.string().nullable(),
  doneOn: z.string(),
  km: z.number().nullable(),
  garage: z.string().nullable(),
  notes: z.string().nullable(),
  /** Coût saisi avec l'entretien (« 380.00 »), absent d'une API pas encore à jour. */
  cost: z.string().nullable().optional().default(null),
});
export type MaintenanceRecord = z.infer<typeof maintenanceRecordSchema>;

const MAINTENANCE_KEY = ["maintenance"] as const;
const plansSchema = z.object({ plans: z.array(maintenancePlanSchema) });

export function useMaintenancePlans(vehicleId: string) {
  return useQuery({
    queryKey: [...MAINTENANCE_KEY, "plans", vehicleId],
    queryFn: () => api(`/vehicles/${encodeURIComponent(vehicleId)}/maintenance-plans`, { schema: plansSchema }),
    staleTime: 60_000,
  });
}

export function useMaintenanceRecords(vehicleId: string) {
  return useQuery({
    queryKey: [...MAINTENANCE_KEY, "records", vehicleId],
    queryFn: () =>
      api(`/vehicles/${encodeURIComponent(vehicleId)}/maintenance-records`, { schema: z.object({ records: z.array(maintenanceRecordSchema) }) }),
  });
}

/** Entretiens à prévoir ou en retard dans toute la flotte (tableau de bord). */
export function useDueMaintenance() {
  return useQuery({
    queryKey: [...MAINTENANCE_KEY, "due"],
    queryFn: () => api("/maintenance/due", { schema: plansSchema }),
    staleTime: 5 * 60_000,
  });
}

export interface MaintenancePlanInput {
  type: MaintenanceType;
  label: string | null;
  intervalKm: number | null;
  intervalDays: number | null;
  lastDoneAt: string | null;
  lastDoneKm: number | null;
}

export interface MaintenanceRecordInput {
  planId?: string;
  type?: MaintenanceType;
  label?: string | null;
  doneOn: string;
  km: number | null;
  garage: string | null;
  notes: string | null;
  /** Coût de l'entretien, enregistré comme une dépense. */
  cost?: number | null;
}

export function useMaintenanceActions(vehicleId: string) {
  const queryClient = useQueryClient();
  // Un entretien avec kilométrage crée aussi un relevé de compteur : la fiche du véhicule est à relire.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: MAINTENANCE_KEY }),
      queryClient.invalidateQueries({ queryKey: ["vehicles", vehicleId, "odometer"] }),
      queryClient.invalidateQueries({ queryKey: ["expenses"] }),
    ]);
  const base = `/vehicles/${encodeURIComponent(vehicleId)}`;
  return {
    createPlan: useMutation({
      mutationFn: (body: MaintenancePlanInput) => api(`${base}/maintenance-plans`, { method: "POST", body }),
      onSuccess: refresh,
    }),
    removePlan: (id: string) => api(`/maintenance-plans/${encodeURIComponent(id)}`, { method: "DELETE" }).then(refresh),
    addRecord: useMutation({
      mutationFn: (body: MaintenanceRecordInput) => api(`${base}/maintenance-records`, { method: "POST", body }),
      onSuccess: refresh,
    }),
  };
}
