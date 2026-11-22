import { StyleSheet, Text, View } from "react-native";
import { SPEED_BANDS } from "@/lib/route-speed";
import { colors, fonts, spacing } from "@/lib/theme";

/** Légende des couleurs du tracé, sous la carte. */
export function SpeedLegend() {
  return (
    <View style={styles.row} accessible accessibilityLabel="Couleur du tracé selon la vitesse, du jaune (lent) au rouge foncé (plus de 120 km/h)">
      {SPEED_BANDS.map((b) => (
        <View key={b.label} style={styles.item}>
          <View style={[styles.swatch, { backgroundColor: b.color }]} />
          <Text style={styles.text}>{b.label}</Text>
        </View>
      ))}
      <Text style={styles.text}>km/h</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  item: { flexDirection: "row", alignItems: "center", gap: 4 },
  swatch: { width: 18, height: 6, borderRadius: 3 },
  text: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
});
