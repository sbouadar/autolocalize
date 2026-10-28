import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useBranding } from "@/lib/branding-context";
import { colors, radius, spacing } from "@/lib/theme";
import { Button } from "./Button";

export function LoadingState({ label = "Chargement…" }: { label?: string }) {
  const branding = useBranding();
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={branding.primaryColor} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Text style={styles.title}>Impossible d’afficher ces données</Text>
      <Text style={styles.muted}>{message}</Text>
      {onRetry ? <Button label="Réessayer" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.muted}>{message}</Text> : null}
    </View>
  );
}

/** Bandeau d'avertissement non bloquant (données anciennes, Traccar indisponible…). */
export function Banner({ message, tone = "warning" }: { message: string; tone?: "warning" | "danger" }) {
  const palette =
    tone === "danger"
      ? { bg: colors.dangerSoft, fg: colors.danger }
      : { bg: colors.warningSoft, fg: colors.warning };
  return (
    <View style={[styles.banner, { backgroundColor: palette.bg }]} accessibilityRole="alert">
      <Text style={[styles.bannerText, { color: palette.fg }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  title: { fontSize: 17, fontWeight: "600", color: colors.text, textAlign: "center" },
  muted: { fontSize: 14, color: colors.muted, textAlign: "center" },
  banner: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.sm },
  bannerText: { fontSize: 14, fontWeight: "500" },
});
