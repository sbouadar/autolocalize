// Alertes du client : GET /alerts (voir apps/api/src/routes/events.ts).
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";
import { formatSpeed } from "./format";

export const alertSchema = z.object({
  id: z.string(),
  // Type inconnu (ajouté par une version plus récente de l'API) : affiché de façon générique.
  type: z.string(),
  eventTime: z.string(),
  vehicleId: z.string().nullable(),
  vehicleName: z.string(),
  zoneName: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  speedKmh: z.number().nullable(),
  detail: z.string().nullable(),
});
export type Alert = z.infer<typeof alertSchema>;

const alertsResponseSchema = z.object({ alerts: z.array(alertSchema), hasMore: z.boolean() });

/** Nombre d'alertes chargées (les plus récentes). */
export const ALERTS_PAGE_SIZE = 50;
const ALERTS_REFRESH_MS = 30_000;

export function useAlerts() {
  return useQuery({
    queryKey: ["alerts"],
    queryFn: () => api(`/alerts?limit=${ALERTS_PAGE_SIZE}`, { schema: alertsResponseSchema }),
    refetchInterval: ALERTS_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

// Alarmes Traccar les plus courantes ; les autres sont affichées sous le libellé générique.
const ALARM_LABELS: Record<string, string> = {
  lowBattery: "Batterie du traceur faible",
  lowPower: "Alimentation du traceur faible",
  powerCut: "Alimentation du traceur coupée",
  powerOff: "Traceur éteint",
  tampering: "Traceur manipulé",
  removing: "Traceur retiré",
  sos: "Appel d’urgence (SOS)",
  vibration: "Vibration détectée",
  movement: "Mouvement détecté",
  tow: "Remorquage détecté",
  accident: "Choc détecté",
};

/** Libellé de l'alerte : « Entrée dans la zone Dépôt », « Excès de vitesse (112 km/h) »… */
export function alertLabel(alert: Pick<Alert, "type" | "zoneName" | "speedKmh" | "detail">): string {
  switch (alert.type) {
    case "ZONE_ENTER":
      return alert.zoneName ? `Entrée dans la zone ${alert.zoneName}` : "Entrée dans une zone";
    case "ZONE_EXIT":
      return alert.zoneName ? `Sortie de la zone ${alert.zoneName}` : "Sortie d’une zone";
    case "OVERSPEED":
      return alert.speedKmh != null ? `Excès de vitesse (${formatSpeed(alert.speedKmh)})` : "Excès de vitesse";
    case "DEVICE_OFFLINE":
      return "Traceur hors ligne";
    case "ALARM":
      return (alert.detail && ALARM_LABELS[alert.detail]) || "Alarme du traceur";
    default:
      return "Alerte";
  }
}
