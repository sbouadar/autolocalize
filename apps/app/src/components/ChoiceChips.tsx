import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBranding } from "@/lib/branding-context";
import { colors, fonts, radius, spacing } from "@/lib/theme";

interface ChoiceChipsProps<K extends string> {
  options: { key: K; label: string }[];
  value: K | null;
  onChange: (key: K) => void;
  /** Nom du groupe pour les lecteurs d'écran. */
  label: string;
  /** Fond des pastilles non choisies : « surface » sur un aplat (carte), « fill » sur fond blanc. */
  tone?: "surface" | "fill";
}

/** Choix exclusif en pastilles qui passent à la ligne (plus de 3 options, libellés de longueurs variées). */
export function ChoiceChips<K extends string>({ options, value, onChange, label, tone = "surface" }: ChoiceChipsProps<K>) {
  const branding = useBranding();
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => [
              styles.chip,
              { backgroundColor: active ? branding.primaryColor : tone === "fill" ? colors.fill : colors.surface },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={[styles.text, active && { color: branding.onPrimary }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.full },
  text: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
});
