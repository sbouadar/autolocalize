import { Redirect, Stack } from "expo-router";
import { useMemo } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ErrorState, LoadingState } from "@/components/States";
import { ForcePasswordChangeScreen } from "@/features/profile/ForcePasswordChangeScreen";
import { userMessage } from "@/lib/api";
import { ME_QUERY_KEY, useAuth } from "@/lib/auth";
import { resolveBranding } from "@/lib/branding";
import { BrandingProvider } from "@/lib/branding-context";
import { colors } from "@/lib/theme";
import { useQueryClient } from "@tanstack/react-query";

/** Espace connecté : garde de session + branding du client pour tous les écrans enfants. */
export default function AppLayout() {
  const { me, loading, error } = useAuth();
  const queryClient = useQueryClient();
  const branding = useMemo(() => resolveBranding(me?.tenant), [me?.tenant]);

  if (loading) return <LoadingState />;
  if (error && !me) {
    // Serveur injoignable : on ne déconnecte pas, on propose de réessayer.
    return (
      <ErrorState
        message={userMessage(error)}
        onRetry={() => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })}
      />
    );
  }
  if (!me) return <Redirect href="/login" />;

  // Mot de passe provisoire : l'API refuse tout le reste tant qu'il n'est pas changé.
  if (me.user.mustChangePassword) {
    return (
      <BrandingProvider value={branding}>
        <ForcePasswordChangeScreen />
      </BrandingProvider>
    );
  }

  return (
    <BrandingProvider value={branding}>
      <Stack
        screenOptions={{
          header: () => <AppHeader />,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </BrandingProvider>
  );
}
