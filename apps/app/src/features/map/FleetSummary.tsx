import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { colors, fonts, spacing } from "@/lib/theme";
import type { Vehicle } from "@/lib/types";
import { vehicleState, type VehicleStateKey } from "@/lib/vehicles";

const STATE_ORDER: { key: VehicleStateKey; label: (n: number) => string }[] = [
  { key: "moving", label: () => "en route" },
  { key: "stopped", label: () => "à l’arrêt" },
  { key: "offline", label: () => "hors ligne" },
  { key: "disabled", label: (n) => (n > 1 ? "désactivés" : "désactivé") },
];

/** Sous la carte quand aucun véhicule n'est sélectionné : état de la flotte et accès à la liste. */
export function FleetSummary({ vehicles, onShowList }: { vehicles: Vehicle[]; onShowList?: () => void }) {
  const counts = new Map<VehicleStateKey, { n: number; color: string }>();
  for (const v of vehicles) {
    const s = vehicleState(v);
    const c = counts.get(s.key) ?? { n: 0, color: s.color };
    counts.set(s.key, { ...c, n: c.n + 1 });
  }
  const parts = STATE_ORDER.flatMap((s) => {
    const c = counts.get(s.key);
    return c ? [{ key: s.key, text: `${c.n} ${s.label(c.n)}`, color: c.color }] : [];
  });

  return (
    <View style={styles.panel}>
      <Text style={styles.title} accessibilityRole="header">
        {vehicles.length} véhicule{vehicles.length > 1 ? "s" : ""}
      </Text>
      <View style={styles.counts}>
        {parts.map((p) => (
          <View key={p.key} style={styles.count}>
            <View style={[styles.dot, { backgroundColor: p.color }]} />
            <Text style={styles.countText}>{p.text}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.hint}>Touchez un véhicule sur la carte pour afficher son détail.</Text>
      {onShowList ? <Button label="Liste des véhicules" variant="secondary" onPress={onShowList} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm },
  title: { fontFamily: fonts.heavy, fontSize: 20, letterSpacing: -0.3, color: colors.text },
  counts: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, rowGap: spacing.xs },
  count: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  countText: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  hint: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted, marginBottom: spacing.xs },
});
