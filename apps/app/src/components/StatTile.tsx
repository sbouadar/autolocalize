import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/lib/theme";

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
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 2,
  },
  label: { fontSize: 13, color: colors.muted },
  value: { fontSize: 22, fontWeight: "700", color: colors.text },
  hint: { fontSize: 12, color: colors.muted },
});
