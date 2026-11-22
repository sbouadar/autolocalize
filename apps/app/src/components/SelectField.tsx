import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBranding } from "@/lib/branding-context";
import { colors, fonts, radius, shadows, spacing } from "@/lib/theme";

interface SelectFieldProps<K extends string> {
  label: string;
  options: { key: K; label: string }[];
  value: K | null;
  onChange: (key: K) => void;
  /** Texte affiché tant que rien n'est choisi. */
  placeholder?: string;
}

/** Liste déroulante : un champ qui ouvre la liste des choix dans une fenêtre. */
export function SelectField<K extends string>({ label, options, value, onChange, placeholder = "Choisir" }: SelectFieldProps<K>) {
  const branding = useBranding();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: current?.label ?? placeholder }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.field, pressed && { opacity: 0.7 }]}
      >
        <Text style={[styles.value, !current && { color: colors.muted }]} numberOfLines={1}>
          {current?.label ?? placeholder}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={20} color={colors.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Fermer la liste">
          {/* Un appui dans la fenêtre ne doit pas la fermer. */}
          <Pressable style={styles.sheet} onPress={() => undefined} accessible={false}>
            <Text style={styles.title}>{label}</Text>
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {options.map((option) => {
                const active = option.key === value;
                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={option.label}
                    onPress={() => {
                      onChange(option.key);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [styles.option, active && { backgroundColor: branding.primaryColor }, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={[styles.optionText, active && { color: branding.onPrimary }]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
  field: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderCurve: "continuous",
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  value: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text },
  backdrop: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.lg, backgroundColor: "rgba(20, 20, 20, 0.45)" },
  sheet: {
    width: "100%",
    maxWidth: 380,
    maxHeight: "80%",
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: colors.background,
    boxShadow: shadows.overlay,
  },
  title: { fontFamily: fonts.heavy, fontSize: 17, color: colors.text },
  list: { flexGrow: 0 },
  option: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md },
  optionText: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
});
