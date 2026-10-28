import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { periodQuery, type PeriodRange } from "./period";
import { kpisResponseSchema } from "./types";

/** Les rapports Traccar sont coûteux : rafraîchissement toutes les minutes seulement. */
const KPIS_REFRESH_MS = 60_000;

export function useKpis(range: PeriodRange) {
  return useQuery({
    queryKey: ["dashboard", "kpis", range],
    queryFn: () => api(`/dashboard/kpis?${periodQuery(range)}`, { schema: kpisResponseSchema }),
    refetchInterval: KPIS_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}
