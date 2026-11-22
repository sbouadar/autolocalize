import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/States";
import { ALERTS_PAGE_SIZE, alertLabel, useAlerts, type Alert } from "@/lib/alerts";
import { userMessage } from "@/lib/api";
import { useBranding } from "@/lib/branding-context";
import { formatDateTime, relativeTime } from "@/lib/format";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";

function AlertRow({ alert }: { alert: Alert }) {
  const router = useRouter();
  const label = alertLabel(alert);
  const content = (
    <>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.muted}>
        {alert.vehicleName}
        {alert.driverName ? ` (${alert.driverName})` : ""} · {relativeTime(alert.eventTime)} ({formatDateTime(alert.eventTime)})
      </Text>
    </>
  );
  // Véhicule retiré du client depuis : l'alerte reste affichée, sans lien vers sa fiche.
  if (!alert.vehicleId) return <View style={styles.row}>{content}</View>;
  const vehicleId = alert.vehicleId;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${alert.vehicleName}. Ouvrir la fiche du véhicule`}
      onPress={() => router.push({ pathname: "/vehicles/[id]", params: { id: vehicleId } })}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      {content}
    </Pressable>
  );
}

/** Alertes des véhicules du client (zones, vitesse, traceur), les plus récentes d'abord. */
export function AlertsScreen() {
  const branding = useBranding();
  useDocumentTitle(`Alertes — ${branding.name}`);
  const { data, isPending, error, refetch } = useAlerts();

  if (isPending) return <LoadingState label="Chargement des alertes…" />;
  if (!data) return <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />;
  if (data.alerts.length === 0) {
    return (
      <EmptyState
        title="Aucune alerte"
        message="Les entrées et sorties de zone, les excès de vitesse et les alarmes des traceurs apparaîtront ici."
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {error ? <Banner message="Connexion perdue : les alertes ne sont plus actualisées." /> : null}
      <View style={styles.list}>
        {data.alerts.map((alert) => (
          <AlertRow key={alert.id} alert={alert} />
        ))}
      </View>
      {data.hasMore ? (
        <Text style={styles.muted}>Seules les {ALERTS_PAGE_SIZE} alertes les plus récentes sont affichées.</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 900, alignSelf: "center" },
  list: { gap: spacing.sm },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  label: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
});
