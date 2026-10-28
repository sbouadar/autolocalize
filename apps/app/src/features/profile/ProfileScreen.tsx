import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { TenantLogo } from "@/components/TenantLogo";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { colors, spacing } from "@/lib/theme";
import type { Role } from "@/lib/types";
import { useDocumentTitle } from "@/lib/use-document-title";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { CompanyEditor } from "./CompanyEditor";

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Administrateur de la plateforme",
  TENANT_ADMIN: "Administrateur",
  VIEWER: "Consultation",
};

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>
        {value}
      </Text>
    </View>
  );
}

/** Profil : compte, société (branding du client, modifiable par son admin), mot de passe, déconnexion. */
export function ProfileScreen() {
  const { me, signOut } = useAuth();
  const branding = useBranding();
  useDocumentTitle(`Profil — ${branding.name}`);
  if (!me) return null;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card title="Mon compte">
        <Row label="Nom" value={me.user.name} />
        <Row label="E-mail" value={me.user.email} />
        <Row label="Rôle" value={ROLE_LABELS[me.user.role]} />
      </Card>

      {me.tenant ? (
        <Card title="Ma société">
          <View style={styles.company}>
            <TenantLogo branding={branding} size={56} />
            <Text style={styles.companyName}>{branding.name}</Text>
          </View>
          <Row label="Adresse" value={branding.address} />
          <Row label="Téléphone" value={branding.phone} />
          <Row label="E-mail" value={branding.email} />
          {me.user.role === "TENANT_ADMIN" ? <CompanyEditor tenant={me.tenant} /> : null}
        </Card>
      ) : null}

      <Card title="Mot de passe">
        <ChangePasswordForm />
      </Card>

      <Button label="Se déconnecter" variant="secondary" onPress={signOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, width: "100%", maxWidth: 640, alignSelf: "center" },
  row: { gap: 2 },
  label: { fontSize: 13, color: colors.muted },
  value: { fontSize: 15, color: colors.text },
  company: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  companyName: { flex: 1, fontSize: 17, fontWeight: "600", color: colors.text },
});
