import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Pas de nouvelle tentative sur les erreurs « définitives » (droits, introuvable, validation).
        retry: (failureCount, error) => {
          if (error instanceof ApiError && [400, 401, 403, 404].includes(error.status)) return false;
          return failureCount < 2;
        },
        staleTime: 5_000,
      },
    },
  });
}
