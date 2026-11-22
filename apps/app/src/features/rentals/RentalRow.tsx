import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDateTime } from "@/lib/format";
import { RENTAL_STATUS_LABELS, type Rental } from "@/lib/rentals";
import { colors, fonts, radius, spacing } from "@/lib/theme";

/** Couleurs de l'état d'une location (fixes). Une location en retard passe en rouge. */
export function rentalTone(rental: Pick<Rental, "status" | "late">): { label: string; color: string; soft: string } {
  if (rental.late) return { label: "En retard", color: colors.danger, soft: colors.dangerSoft };
  switch (rental.status) {
    case "ONGOING":
      return { label: RENTAL_STATUS_LABELS.ONGOING, color: colors.online, soft: colors.onlineSoft };
    case "RESERVED":
      return { label: RENTAL_STATUS_LABELS.RESERVED, color: colors.warning, soft: colors.warningSoft };
    default:
      return { label: RENTAL_STATUS_LABELS[rental.status], color: colors.offline, soft: colors.border };
  }
}

export function RentalStatusBadge({ rental }: { rental: Pick<Rental, "status" | "late"> }) {
  const tone = rentalTone(rental);
  return (
    <View style={[styles.badge, { backgroundColor: tone.soft }]}>
      <Text style={[styles.badgeText, { color: tone.color }]}>{tone.label}</Text>
    </View>
  );
}

/** Ligne d'une location : véhicule, locataire, période, état. */
export function RentalRow({
  rental,
  onPress,
  showVehicle = true,
  tone: background = "fill",
}: {
  rental: Rental;
  onPress: () => void;
  showVehicle?: boolean;
  /** Fond de la ligne : « fill » sur fond blanc, « surface » dans un bloc en aplat. */
  tone?: "fill" | "surface";
}) {
  const tone = rentalTone(rental);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${rental.vehicleName}, ${rental.customerName}, ${tone.label}. Ouvrir la location`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, background === "surface" && { backgroundColor: colors.surface }, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.flex}>
        <Text style={styles.name} numberOfLines={1}>
          {showVehicle ? `${rental.vehicleName} · ${rental.customerName}` : rental.customerName}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {formatDateTime(rental.startAt)} → {formatDateTime(rental.endAt)}
        </Text>
      </View>
      <RentalStatusBadge rental={rental} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
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
