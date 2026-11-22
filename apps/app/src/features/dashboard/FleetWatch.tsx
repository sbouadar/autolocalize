import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDateOnly } from "@/lib/dates";
import {
  UNAVAILABILITY_REASON_LABELS,
  deadlineDelay,
  deadlineName,
  maintenanceDelay,
  maintenanceName,
  useCurrentUnavailabilities,
  useDueDeadlines,
  useDueMaintenance,
} from "@/lib/fleet-care";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { DEADLINE_STATUS_STYLE } from "../vehicle/DeadlinesCard";
import { MAINTENANCE_STATUS_STYLE } from "../vehicle/MaintenanceCard";

/** Délai (en jours) des échéances montrées sur le tableau de bord. */
const DUE_WITHIN_DAYS = 30;

/**
 * « À surveiller » : véhicules immobilisés, entretiens à prévoir ou en retard, échéances dépassées ou
 * à renouveler sous 30 jours.
 * Ne s'affiche que s'il y a quelque chose à signaler ; chaque ligne mène à la fiche du véhicule.
 */
export function FleetWatch() {
  const router = useRouter();
  const deadlines = useDueDeadlines(DUE_WITHIN_DAYS).data?.deadlines ?? [];
  const unavailable = useCurrentUnavailabilities().data?.unavailabilities ?? [];
  const maintenance = useDueMaintenance().data?.plans ?? [];
  if (deadlines.length === 0 && unavailable.length === 0 && maintenance.length === 0) return null;
  const open = (id: string) => router.push({ pathname: "/vehicles/[id]", params: { id } });

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">
        À surveiller
      </Text>
      {unavailable.map((u) => (
        <Pressable
          key={`u-${u.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${u.vehicleName} indisponible : ${UNAVAILABILITY_REASON_LABELS[u.reason]}. Ouvrir la fiche`}
          onPress={() => open(u.vehicleId)}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>
              {u.vehicleName}
            </Text>
            <Text style={styles.muted} numberOfLines={1}>
              Indisponible : {UNAVAILABILITY_REASON_LABELS[u.reason].toLowerCase()}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: colors.warningSoft }]}>
            <Text style={[styles.badgeText, { color: colors.warning }]}>immobilisé</Text>
          </View>
        </Pressable>
      ))}
      {maintenance.map((m) => {
        const tone = MAINTENANCE_STATUS_STYLE[m.status];
        return (
          <Pressable
            key={`m-${m.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${m.vehicleName}, ${maintenanceName(m)} : ${maintenanceDelay(m)}. Ouvrir la fiche`}
            onPress={() => open(m.vehicleId)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.flex}>
              <Text style={styles.name} numberOfLines={1}>
                {m.vehicleName}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                Entretien : {maintenanceName(m).toLowerCase()}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: tone.soft }]}>
              <Text style={[styles.badgeText, { color: tone.color }]}>{maintenanceDelay(m)}</Text>
            </View>
          </Pressable>
        );
      })}
      {deadlines.map((d) => {
        const tone = DEADLINE_STATUS_STYLE[d.status];
        return (
          <Pressable
            key={`d-${d.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${d.vehicleName}, ${deadlineName(d)} : ${deadlineDelay(d.daysLeft)}. Ouvrir la fiche`}
            onPress={() => open(d.vehicleId)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.flex}>
              <Text style={styles.name} numberOfLines={1}>
                {d.vehicleName}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {deadlineName(d)} · {formatDateOnly(d.expiresOn)}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: tone.soft }]}>
              <Text style={[styles.badgeText, { color: tone.color }]}>{deadlineDelay(d.daysLeft)}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: spacing.sm },
  title: { fontSize: 18, fontFamily: fonts.heavy, letterSpacing: -0.3, color: colors.text },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.fill,
  },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full },
  badgeText: { fontFamily: fonts.heavy, fontSize: 12 },
});
