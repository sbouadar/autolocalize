import { useState, type ComponentRef, type Ref } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useBranding } from "@/lib/branding-context";
import { colors, fonts, radius, spacing } from "@/lib/theme";

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}

export function TextField({ label, error, onFocus, onBlur, ref, ...rest }: TextFieldProps) {
  const branding = useBranding();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          focused && { borderColor: branding.primaryText },
          error ? { borderColor: colors.danger } : null,
        ]}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
  input: {
    minHeight: 50,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderCurve: "continuous",
    paddingHorizontal: spacing.md,
    fontFamily: fonts.regular, fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
});
