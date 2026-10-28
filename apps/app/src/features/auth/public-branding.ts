import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { STORAGE_KEYS, storage } from "@/lib/storage";
import { publicBrandingSchema, type PublicBranding } from "@/lib/types";

const SLUG = /^[a-z0-9-]{1,64}$/;

/** Branding public d'un client par son slug ; null (branding plateforme) si inconnu ou invalide. */
export function usePublicBranding(slug: string | null) {
  const validSlug = slug && SLUG.test(slug) ? slug : null;
  return useQuery({
    queryKey: ["public-branding", validSlug],
    enabled: validSlug !== null,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<PublicBranding | null> => {
      try {
        return await api(`/public/tenants/${validSlug}/branding`, { schema: publicBrandingSchema });
      } catch (err) {
        // Slug inconnu : on affiche simplement la page AutoLocalize, sans message d'erreur.
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });
}

/** Slug du dernier client connecté sur cet appareil (personnalise /login sans slug). */
export function useLastSlug(): { slug: string | null; ready: boolean } {
  const [state, setState] = useState<{ slug: string | null; ready: boolean }>({ slug: null, ready: false });
  useEffect(() => {
    let alive = true;
    storage.get(STORAGE_KEYS.lastSlug).then((slug) => alive && setState({ slug, ready: true }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
