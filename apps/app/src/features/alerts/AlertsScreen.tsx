import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/States";
import { ALERTS_PAGE_SIZE, alertLabel, useAlerts, type Alert } from "@/lib/alerts";
import { userMessage } from "@/lib/api";
import { useBranding } from "@/lib/branding-context";
import { formatDateTime, relativeTime } from "@/lib/format";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

/** Icône et couleur d'une alerte : rouge pour l'urgent, orange pour ce qui est à prévoir. */
export function alertIcon(type: string): {
  name: IconName;
  color: string;
  soft: string;
} {
  if (type === "OVERSPEED")
    return {
      name: "speedometer",
      color: colors.danger,
      soft: colors.dangerSoft,
    };
  if (type === "ALARM" || type === "RENTAL_UNAUTHORIZED_USE") return { name: "alert", color: colors.danger, soft: colors.dangerSoft };
  if (type === "DEVICE_OFFLINE")
    return {
      name: "access-point-off",
      color: colors.offline,
      soft: colors.border,
    };
  if (type === "ZONE_ENTER" || type === "ZONE_EXIT" || type === "RENTAL_ZONE_EXIT")
    return {
      name: "map-marker-radius",
      color: colors.text,
      soft: colors.surface,
    };
  if (type.startsWith("MAINTENANCE")) return { name: "wrench", color: colors.warning, soft: colors.warningSoft };
  if (type.startsWith("DRIVER_LICENSE"))
    return {
      name: "card-account-details",
      color: colors.warning,
      soft: colors.warningSoft,
    };
  if (type === "RENTAL_OVERDUE")
    return {
      name: "clock-alert-outline",
      color: colors.danger,
      soft: colors.dangerSoft,
    };
  if (type.startsWith("DOCUMENT"))
    return {
      name: "file-document-outline",
      color: colors.warning,
      soft: colors.warningSoft,
    };
  return { name: "bell-outline", color: colors.text, soft: colors.surface };
}

function AlertRow({ alert }: { alert: Alert }) {
  const router = useRouter();
  const label = alertLabel(alert);
  const icon = alertIcon(alert.type);
  const content = (
    <>
      <View style={[styles.icon, { backgroundColor: icon.soft }]}>
        <MaterialCommunityIcons name={icon.name} size={20} color={icon.color} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.muted}>
          {alert.vehicleName}
          {alert.driverName ? ` (${alert.driverName})` : ""} · {relativeTime(alert.eventTime)} ({formatDateTime(alert.eventTime)})
        </Text>
      </View>
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
      {data.hasMore ? <Text style={styles.muted}>Seules les {ALERTS_PAGE_SIZE} alertes les plus récentes sont affichées.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: spacing.lg,
    gap: spacing.md,
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
  },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.fill,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    padding: spacing.md,
    gap: spacing.md,
  },
  flex: { flex: 1, gap: 2 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
});
