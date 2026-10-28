import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { formatCoordinates, formatDateTime } from "@/lib/format";
import { colors, radius, spacing } from "@/lib/theme";
import type { Vehicle } from "@/lib/types";
import { ignitionLabel, lastSeen, movementLabel, vehicleLabel, vehicleStatus } from "@/lib/vehicles";

interface VehicleSummaryProps {
  vehicle: Vehicle;
  onClose: () => void;
  /** Ouvre la fiche complète du véhicule. */
  onOpen: () => void;
}

/** Carte flottante du véhicule sélectionné, avec accès à sa fiche. */
export function VehicleSummary({ vehicle, onClose, onOpen }: VehicleSummaryProps) {
  const status = vehicleStatus(vehicle);
  const p = vehicle.position;
  const details = [
    movementLabel(p),
    ignitionLabel(p?.ignition),
    p ? (p.address ?? formatCoordinates(p.latitude, p.longitude)) : null,
    `Dernière information : ${formatDateTime(lastSeen(vehicle))}`,
  ].filter((line): line is string => Boolean(line));

  return (
    <View style={styles.card} accessibilityLabel={`Véhicule sélectionné : ${vehicleLabel(vehicle)}`}>
      <View style={styles.header}>
        <View style={styles.title}>
          <Text style={styles.name} numberOfLines={1}>
            {vehicleLabel(vehicle)}
          </Text>
          <View style={styles.status}>
            <View style={[styles.dot, { backgroundColor: status.color }]} />
            <Text style={styles.muted}>{status.label}</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          onPress={onClose}
          hitSlop={10}
          style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>
      {details.map((line) => (
        <Text key={line} style={styles.detail}>
          {line}
        </Text>
      ))}
      <View style={styles.actions}>
        <Button label="Voir la fiche et l’historique" variant="secondary" onPress={onOpen} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    // Au-dessus des volets de Leaflet (z-index jusqu'à 1000) sur le web.
    zIndex: 1100,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, marginBottom: spacing.xs },
  title: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: "700", color: colors.text },
  status: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  muted: { fontSize: 13, color: colors.muted },
  detail: { fontSize: 14, color: colors.text },
  actions: { marginTop: spacing.sm },
  close: { paddingHorizontal: spacing.xs },
  closeText: { fontSize: 24, lineHeight: 24, color: colors.muted },
});
