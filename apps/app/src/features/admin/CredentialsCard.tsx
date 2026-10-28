import { StyleSheet, Text, View } from "react-native";
import type { Credentials } from "@/lib/admin";
import { colors, radius, spacing } from "@/lib/theme";

const PUBLIC_ORIGIN = "https://autolocalize.net";

/**
 * Identifiants provisoires à transmettre au client. Affichés une seule fois : ils ne sont ni
 * stockés ni récupérables ensuite (une nouvelle réinitialisation en génère d'autres).
 */
export function CredentialsCard({ credentials, slug }: { credentials: Credentials; slug: string }) {
  return (
    <View style={styles.card} accessibilityRole="alert">
      <Text style={styles.title}>Identifiants à transmettre au client</Text>
      <Text style={styles.warning}>
        Notez-les maintenant : le mot de passe provisoire ne sera plus affiché. Le client devra le changer à sa première
        connexion.
      </Text>
      <Text style={styles.label}>Adresse de connexion</Text>
      <Text style={styles.value} selectable>
        {`${PUBLIC_ORIGIN}/login/${slug}`}
      </Text>
      <Text style={styles.label}>E-mail</Text>
      <Text style={styles.value} selectable>
        {credentials.email}
      </Text>
      <Text style={styles.label}>Mot de passe provisoire</Text>
      <Text style={[styles.value, styles.password]} selectable>
        {credentials.temporaryPassword}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  warning: { fontSize: 13, color: colors.warning, marginBottom: spacing.sm },
  label: { fontSize: 12, color: colors.muted, marginTop: spacing.xs },
  value: { fontSize: 15, color: colors.text },
  password: { fontSize: 20, fontWeight: "700", letterSpacing: 1, fontFamily: "monospace" },
});
