import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { periodQuery, periodRange, type PeriodKey } from "./period";
import { kpisResponseSchema } from "./types";

/** Les rapports Traccar sont coûteux : rafraîchissement toutes les minutes seulement. */
const KPIS_REFRESH_MS = 60_000;

/**
 * Les bornes de la période sont calculées à chaque chargement, pas à l'ouverture de l'écran : chaque
 * rafraîchissement va jusqu'à l'instant présent, et « Aujourd'hui » change de jour à minuit.
 */
export function useKpis(period: PeriodKey) {
  return useQuery({
    queryKey: ["dashboard", "kpis", period],
    queryFn: () => api(`/dashboard/kpis?${periodQuery(periodRange(period))}`, { schema: kpisResponseSchema }),
    refetchInterval: KPIS_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}
