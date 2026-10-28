import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from "react-native";
import { useBranding } from "@/lib/branding-context";
import { colors, radius, spacing } from "@/lib/theme";

interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  /** danger : action à conséquences (coupure du moteur), toujours en rouge quelle que soit la marque. */
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
}

export function Button({ label, variant = "primary", loading = false, disabled, ...rest }: ButtonProps) {
  const branding = useBranding();
  const inactive = disabled || loading;
  const palette =
    variant === "primary"
      ? { bg: branding.primaryColor, fg: branding.onPrimary, border: undefined }
      : variant === "danger"
        ? { bg: colors.danger, fg: "#FFFFFF", border: undefined }
        : { bg: colors.surface, fg: colors.text, border: colors.border };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: palette.bg },
        palette.border ? { borderColor: palette.border, borderWidth: 1 } : null,
        pressed && !inactive && styles.pressed,
        inactive && styles.inactive,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === "secondary" ? branding.primaryColor : palette.fg} />
      ) : (
        <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.85 },
  inactive: { opacity: 0.6 },
  label: { fontSize: 16, fontWeight: "600" },
});
