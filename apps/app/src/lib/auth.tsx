import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { z } from "zod";
import { ApiError, api, setSessionToken, setUnauthorizedHandler } from "./api";
import { STORAGE_KEYS, storage } from "./storage";
import { meSchema, type Me } from "./types";

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** Erreur de chargement de la session (réseau, serveur) : distincte de « non connecté ». */
  error: unknown;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const ME_QUERY_KEY = ["me"] as const;

async function fetchMe(): Promise<Me | null> {
  try {
    return await api("/me", { schema: meSchema });
  } catch (err) {
    // 401 : pas de session ; 403 : compte sans client ou abonnement suspendu.
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}

const signInResponseSchema = z.object({ twoFactorRedirect: z.boolean().optional() }).loose();

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    retry: 1,
    staleTime: 5 * 60_000,
  });

  /** Oublie toutes les données privées : rien ne doit survivre à un changement de compte. */
  const forgetSession = useCallback(async () => {
    await setSessionToken(null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_QUERY_KEY[0] });
    queryClient.setQueryData(ME_QUERY_KEY, null);
  }, [queryClient]);

  // Session expirée ou révoquée pendant l'utilisation : retour à la connexion.
  useEffect(() => {
    setUnauthorizedHandler(() => void forgetSession());
    return () => setUnauthorizedHandler(null);
  }, [forgetSession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await forgetSession();
      const result = await api("/auth/sign-in/email", {
        method: "POST",
        body: { email, password },
        schema: signInResponseSchema,
      });
      if (result.twoFactorRedirect) {
        throw new ApiError(0, "La double authentification n'est pas encore disponible dans l'application.");
      }
      const me = await fetchMe();
      if (!me) {
        throw new ApiError(0, "Accès refusé : compte non rattaché à un client ou abonnement suspendu.");
      }
      if (me.tenant) await storage.set(STORAGE_KEYS.lastSlug, me.tenant.slug);
      queryClient.setQueryData(ME_QUERY_KEY, me);
    },
    [forgetSession, queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api("/auth/sign-out", { method: "POST", body: {} });
    } catch {
      // on déconnecte localement quoi qu'il arrive
    }
    await forgetSession();
  }, [forgetSession]);

  const value = useMemo(
    () => ({ me: data ?? null, loading: isPending, error, signIn, signOut }),
    [data, isPending, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return ctx;
}
