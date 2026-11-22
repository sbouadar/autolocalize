// Règles d'alerte du client et types d'alerte masqués par l'utilisateur (alertes, tranche 3).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";

export const alertRuleTypeSchema = z.enum(["AFTER_HOURS", "OFFLINE_DURATION", "ZONE_DWELL"]);
export type AlertRuleType = z.infer<typeof alertRuleTypeSchema>;
export const ALERT_RULE_LABELS: Record<AlertRuleType, string> = {
  AFTER_HOURS: "Contact hors horaires",
  OFFLINE_DURATION: "Traceur muet",
  ZONE_DWELL: "Temps dans une zone",
};

export const alertRuleSchema = z.object({
  id: z.string(),
  type: alertRuleTypeSchema,
  name: z.string().nullable(),
  vehicleId: z.string().nullable(),
  zoneId: z.string().nullable(),
  startMinute: z.number().nullable(),
  endMinute: z.number().nullable(),
  days: z.array(z.number()),
  thresholdMinutes: z.number().nullable(),
  enabled: z.boolean(),
  vehicleName: z.string().nullable(),
  zoneName: z.string().nullable(),
  summary: z.string(),
});
export type AlertRule = z.infer<typeof alertRuleSchema>;

export interface AlertRuleInput {
  type?: AlertRuleType;
  vehicleId?: string | null;
  zoneId?: string | null;
  startMinute?: number | null;
  endMinute?: number | null;
  days?: number[] | null;
  thresholdMinutes?: number | null;
  enabled?: boolean;
}

const RULES_KEY = ["alert-rules"] as const;
const PREFS_KEY = ["alert-preferences"] as const;

export function useAlertRules() {
  return useQuery({ queryKey: RULES_KEY, queryFn: () => api("/alert-rules", { schema: z.object({ rules: z.array(alertRuleSchema) }) }) });
}

export function useAlertRuleActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: RULES_KEY });
  return {
    create: useMutation({ mutationFn: (body: AlertRuleInput) => api("/alert-rules", { method: "POST", body }), onSuccess: refresh }),
    update: (id: string, body: AlertRuleInput) => api(`/alert-rules/${encodeURIComponent(id)}`, { method: "PUT", body }).then(refresh),
    remove: (id: string) => api(`/alert-rules/${encodeURIComponent(id)}`, { method: "DELETE" }).then(refresh),
  };
}

const prefsSchema = z.object({ mutedTypes: z.array(z.string()) });

export function useAlertPreferences() {
  return useQuery({ queryKey: PREFS_KEY, queryFn: () => api("/me/alert-preferences", { schema: prefsSchema }) });
}

export function useSaveAlertPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mutedTypes: string[]) => api("/me/alert-preferences", { method: "PUT", body: { mutedTypes }, schema: prefsSchema }),
    onSuccess: (data) => {
      queryClient.setQueryData(PREFS_KEY, data);
      return queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}

export const WEEKDAYS = [
  { day: 1, label: "Lun" },
  { day: 2, label: "Mar" },
  { day: 3, label: "Mer" },
  { day: 4, label: "Jeu" },
  { day: 5, label: "Ven" },
  { day: 6, label: "Sam" },
  { day: 7, label: "Dim" },
];

export const OFFLINE_DURATIONS = [
  { key: "60", label: "1 h" },
  { key: "360", label: "6 h" },
  { key: "720", label: "12 h" },
  { key: "1440", label: "24 h" },
  { key: "4320", label: "3 jours" },
];

export const DWELL_DURATIONS = [
  { key: "30", label: "30 min" },
  { key: "60", label: "1 h" },
  { key: "120", label: "2 h" },
  { key: "240", label: "4 h" },
  { key: "480", label: "8 h" },
  { key: "1440", label: "24 h" },
];

/** « 07:30 » → 450 minutes. */
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
