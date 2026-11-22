// Liens de partage temporaires de la position d'un véhicule (M10). Voir apps/api/src/routes/share-links.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";

const linkSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  active: z.boolean(),
});
export type ShareLink = z.infer<typeof linkSchema>;

export const SHARE_DURATIONS = [
  { key: "1", label: "1 heure" },
  { key: "24", label: "24 heures" },
  { key: "72", label: "3 jours" },
  { key: "168", label: "7 jours" },
];

const KEY = ["share-links"] as const;

export function useShareLinks(vehicleId: string) {
  return useQuery({
    queryKey: [...KEY, vehicleId],
    queryFn: () => api(`/vehicles/${encodeURIComponent(vehicleId)}/share-links`, { schema: z.object({ links: z.array(linkSchema) }) }),
  });
}

export function useShareLinkActions(vehicleId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...KEY, vehicleId] });
  return {
    create: useMutation({
      mutationFn: (body: { durationHours: number; label: string | null }) =>
        api(`/vehicles/${encodeURIComponent(vehicleId)}/share-links`, {
          method: "POST",
          body,
          schema: z.object({ link: linkSchema, token: z.string(), path: z.string() }),
        }),
      onSuccess: refresh,
    }),
    revoke: (id: string) => api(`/share-links/${encodeURIComponent(id)}`, { method: "DELETE" }).then(refresh),
  };
}

const sharedSchema = z.object({
  vehicleName: z.string(),
  online: z.boolean().nullable(),
  position: z
    .object({ latitude: z.number(), longitude: z.number(), speedKmh: z.number(), course: z.number(), fixTime: z.string() })
    .nullable(),
  expiresAt: z.string(),
});
export type SharedPosition = z.infer<typeof sharedSchema>;

/** Page publique : position du véhicule partagé, relue toutes les 30 s. */
export function useSharedPosition(token: string) {
  return useQuery({
    queryKey: ["public-share", token],
    queryFn: () => api(`/public/share/${encodeURIComponent(token)}`, { schema: sharedSchema }),
    refetchInterval: 30_000,
    retry: false,
  });
}

/** Adresse complète du lien, à envoyer. */
export function shareUrl(path: string): string {
  const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://autolocalize.net";
  return `${origin}${path}`;
}
