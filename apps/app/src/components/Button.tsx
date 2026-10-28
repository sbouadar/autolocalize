import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from "react-native";
import { useBranding } from "@/lib/branding-context";
import { colors, radius, spacing } from "@/lib/theme";

interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  variant?: "primary" | "secondary";
  loading?: boolean;
}

export function Button({ label, variant = "primary", loading = false, disabled, ...rest }: ButtonProps) {
  const branding = useBranding();
  const isPrimary = variant === "primary";
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        isPrimary
          ? { backgroundColor: branding.primaryColor }
          : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
        pressed && !inactive && styles.pressed,
        inactive && styles.inactive,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? branding.onPrimary : branding.primaryColor} />
      ) : (
        <Text style={[styles.label, { color: isPrimary ? branding.onPrimary : colors.text }]}>{label}</Text>
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
