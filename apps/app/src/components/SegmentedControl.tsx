import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBranding } from "@/lib/branding-context";
import { colors, fonts, radius, spacing } from "@/lib/theme";

interface SegmentedControlProps<K extends string> {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  /** Rôle d'accessibilité : onglets (changement de vue) ou boutons radio (filtre, période). */
  kind?: "tab" | "radio";
}

/** Choix exclusif entre quelques options, en pastilles ; la pastille active prend la couleur du client. */
export function SegmentedControl<K extends string>({ options, value, onChange, kind = "radio" }: SegmentedControlProps<K>) {
  const branding = useBranding();
  return (
    <View style={styles.container} accessibilityRole={kind === "tab" ? "tablist" : "radiogroup"}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole={kind}
            accessibilityState={kind === "tab" ? { selected: active } : { checked: active }}
            onPress={() => onChange(option.key)}
            style={[styles.item, active && { backgroundColor: branding.primaryColor }]}
          >
            <Text style={[styles.text, { color: active ? branding.onPrimary : colors.text }]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  item: {
    flex: 1,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.fill,
    paddingHorizontal: spacing.md,
  },
  text: { fontSize: 14, fontFamily: fonts.bold },
});
