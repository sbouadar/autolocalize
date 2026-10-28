import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { TextField } from "@/components/TextField";
import { ApiError, api, userMessage } from "@/lib/api";
import { colors, radius, spacing } from "@/lib/theme";

// Mêmes bornes que l'API (apps/api/src/routes/me.ts).
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

type Fields = { current: string; next: string; confirm: string };
type Errors = Partial<Record<keyof Fields, string>>;

export function validatePasswordChange({ current, next, confirm }: Fields): Errors {
  const errors: Errors = {};
  if (!current) errors.current = "Saisissez votre mot de passe actuel.";
  if (next.length < PASSWORD_MIN) errors.next = `Au moins ${PASSWORD_MIN} caractères.`;
  else if (next.length > PASSWORD_MAX) errors.next = `Au plus ${PASSWORD_MAX} caractères.`;
  else if (next === current) errors.next = "Choisissez un mot de passe différent de l’actuel.";
  if (confirm !== next) errors.confirm = "Les deux mots de passe ne correspondent pas.";
  return errors;
}

/** Changement de mot de passe ; les autres appareils sont déconnectés par l'API. */
export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const [fields, setFields] = useState<Fields>({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const set = (key: keyof Fields) => (value: string) => setFields((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const found = validatePasswordChange(fields);
    setErrors(found);
    setFormError(null);
    setSuccess(false);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      await api("/me/password", {
        method: "POST",
        body: { currentPassword: fields.current, newPassword: fields.next },
      });
      setFields({ current: "", next: "", confirm: "" });
      setSuccess(true);
      onDone?.();
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === "INVALID_PASSWORD" ? "Mot de passe actuel incorrect." : userMessage(err),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.form}>
      <TextField
        label="Mot de passe actuel"
        value={fields.current}
        onChangeText={set("current")}
        error={errors.current}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        editable={!submitting}
      />
      <TextField
        label="Nouveau mot de passe"
        value={fields.next}
        onChangeText={set("next")}
        error={errors.next}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!submitting}
      />
      <TextField
        label="Confirmer le nouveau mot de passe"
        value={fields.confirm}
        onChangeText={set("confirm")}
        error={errors.confirm}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!submitting}
      />
      {formError ? (
        <Text style={styles.error} accessibilityRole="alert">
          {formError}
        </Text>
      ) : null}
      {success ? (
        <Text style={styles.success} accessibilityRole="alert">
          Mot de passe modifié. Vos autres appareils ont été déconnectés.
        </Text>
      ) : null}
      <Button label="Changer le mot de passe" onPress={submit} loading={submitting} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  error: { fontSize: 14, color: colors.danger, backgroundColor: colors.dangerSoft, padding: spacing.md, borderRadius: radius.sm },
  success: { fontSize: 14, color: colors.online, backgroundColor: "#F0FDF4", padding: spacing.md, borderRadius: radius.sm },
});
