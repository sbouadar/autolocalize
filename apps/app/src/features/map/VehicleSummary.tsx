import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { formatCoordinates, formatSpeed, relativeTime } from "@/lib/format";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import type { Vehicle } from "@/lib/types";
import { lastSeen, vehicleLabel, vehicleState, type VehicleState } from "@/lib/vehicles";

/** Pastille d'état (« En route », « À l’arrêt »…), aux couleurs fixes de l'état. */
export function StatePill({ state }: { state: VehicleState }) {
  return (
    <View style={[styles.pill, { backgroundColor: state.soft }]}>
      <View style={[styles.dot, { backgroundColor: state.color }]} />
      <Text style={[styles.pillText, { color: state.color }]}>{state.label}</Text>
    </View>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label} : ${value}`}>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

interface VehicleSummaryProps {
  vehicle: Vehicle;
  onClose: () => void;
  /** Ouvre la fiche complète du véhicule. */
  onOpen: () => void;
  /** Affiche la liste des véhicules (mobile, où carte et liste ne tiennent pas côte à côte). */
  onShowList?: () => void;
}

/** Détail du véhicule sélectionné, sous la carte : état, adresse, vitesse, contact, accès à sa fiche. */
export function VehicleSummary({ vehicle, onClose, onOpen, onShowList }: VehicleSummaryProps) {
  const state = vehicleState(vehicle);
  const p = vehicle.position;
  const place = p ? (p.address ?? formatCoordinates(p.latitude, p.longitude)) : "Position inconnue";
  // Vitesse actuelle seulement pour un traceur en ligne : hors ligne, la dernière vitesse est périmée.
  const speed = !p ? "—" : state.key === "moving" ? formatSpeed(p.speedKmh) : state.key === "stopped" ? formatSpeed(0) : "—";
  const ignition = p?.ignition == null ? "—" : p.ignition ? "Mis" : "Coupé";

  return (
    <View style={styles.panel} accessibilityLabel={`Véhicule sélectionné : ${vehicleLabel(vehicle)}`}>
      <View style={styles.header}>
        <View style={styles.title}>
          <Text style={styles.name} numberOfLines={1}>
            {vehicleLabel(vehicle)}
          </Text>
          <StatePill state={state} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          onPress={onClose}
          hitSlop={8}
          style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>
      <Text style={styles.place} numberOfLines={2}>
        {place}
      </Text>
      <View style={styles.tiles}>
        <Tile label="Vitesse" value={speed} />
        <Tile label="Contact" value={ignition} />
        <Tile label="Mise à jour" value={relativeTime(lastSeen(vehicle))} />
      </View>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button label="Voir la fiche" onPress={onOpen} />
        </View>
        {onShowList ? (
          <View style={styles.action}>
            <Button label="Tous les véhicules" variant="secondary" onPress={onShowList} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  title: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  name: { fontFamily: fonts.heavy, fontSize: 20, letterSpacing: -0.3, color: colors.text, flexShrink: 1 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radius.full,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontFamily: fonts.heavy, fontSize: 12 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.fill,
  },
  closeText: { fontFamily: fonts.medium, fontSize: 22, lineHeight: 24, color: colors.text },
  place: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginTop: -spacing.xs },
  tiles: { flexDirection: "row", gap: spacing.sm },
  tile: {
    flex: 1,
    gap: 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: colors.fill,
  },
  tileLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  tileValue: { fontFamily: fonts.heavy, fontSize: 17, letterSpacing: -0.3, color: colors.text, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1 },
});
