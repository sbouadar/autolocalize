import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, spacing } from "@/lib/theme";

/** Chiffre clé avec son libellé (tableau de bord, totaux d'une période). */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label} : ${value}${hint ? `, ${hint}` : ""}`}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? (
        <Text style={styles.hint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    flexBasis: 140,
    minWidth: 130,
    backgroundColor: colors.fill,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: 2,
  },
  label: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  value: { fontSize: 24, fontFamily: fonts.heavy, letterSpacing: -0.5, fontVariant: ["tabular-nums"], color: colors.text },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
});
