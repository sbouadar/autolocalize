import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BrandingForm, toBrandingValues } from "@/components/BrandingForm";
import { Button } from "@/components/Button";
import { LogoPicker } from "@/components/LogoPicker";
import { api, formMessage } from "@/lib/api";
import { ME_QUERY_KEY } from "@/lib/auth";
import { colors, spacing } from "@/lib/theme";
import type { Tenant } from "@/lib/types";

/** Modification par l'admin du client de son propre branding (nom, coordonnées, couleurs, logo). */
export function CompanyEditor({ tenant }: { tenant: Tenant }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });

  if (!open) return <Button label="Modifier les informations" variant="secondary" onPress={() => setOpen(true)} />;

  const setLogo = async (data: string) => {
    setLogoError(null);
    try {
      await api("/tenant/logo", { method: "POST", body: { data } });
      await refresh();
    } catch (err) {
      setLogoError(formMessage(err));
    }
  };

  return (
    <View style={styles.editor}>
      <BrandingForm
        initial={toBrandingValues(tenant)}
        onSubmit={async (payload) => {
          await api("/tenant/branding", { method: "PUT", body: payload });
          await refresh();
        }}
      />
      <Text style={styles.section}>Logo</Text>
      <LogoPicker onPick={setLogo} />
      {logoError ? <Text style={styles.error}>{logoError}</Text> : null}
      <Button label="Fermer" variant="secondary" onPress={() => setOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  section: { fontSize: 15, fontWeight: "600", color: colors.text },
  error: { fontSize: 13, color: colors.danger },
});
