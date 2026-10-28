import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { formMessage } from "@/lib/api";
import { resolveBranding } from "@/lib/branding";
import { colors, radius, spacing } from "@/lib/theme";
import { Button } from "./Button";
import { TextField } from "./TextField";

export interface BrandingValues {
  name: string;
  address: string;
  phone: string;
  email: string;
  primaryColor: string;
  secondaryColor: string;
}

type Errors = Partial<Record<keyof BrandingValues, string>>;

const HEX = /^#[0-9A-Fa-f]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+().\s-]{4,32}$/;

/** Mêmes règles que l'API (apps/api/src/lib/tenant-branding.ts). */
export function validateBranding(v: BrandingValues): Errors {
  const errors: Errors = {};
  if (!v.name.trim()) errors.name = "Le nom est obligatoire.";
  if (v.name.length > 191) errors.name = "191 caractères au maximum.";
  if (v.address.length > 500) errors.address = "500 caractères au maximum.";
  if (v.phone.trim() && !PHONE.test(v.phone.trim())) errors.phone = "Numéro de téléphone invalide.";
  if (v.email.trim() && !EMAIL.test(v.email.trim())) errors.email = "Adresse e-mail invalide.";
  if (!HEX.test(v.primaryColor)) errors.primaryColor = "Format #RRGGBB, par exemple #1E3A8A.";
  if (!HEX.test(v.secondaryColor)) errors.secondaryColor = "Format #RRGGBB, par exemple #F59E0B.";
  return errors;
}

/** Corps envoyé à l'API : champs vides → null (effacement). */
export function brandingPayload(v: BrandingValues) {
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  return {
    name: v.name.trim(),
    address: orNull(v.address),
    phone: orNull(v.phone),
    email: orNull(v.email),
    primaryColor: v.primaryColor.toUpperCase(),
    secondaryColor: v.secondaryColor.toUpperCase(),
  };
}

export function toBrandingValues(t: {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  primaryColor: string;
  secondaryColor: string;
}): BrandingValues {
  return {
    name: t.name,
    address: t.address ?? "",
    phone: t.phone ?? "",
    email: t.email ?? "",
    primaryColor: t.primaryColor,
    secondaryColor: t.secondaryColor,
  };
}

function Swatch({ color }: { color: string }) {
  return <View style={[styles.swatch, { backgroundColor: HEX.test(color) ? color : colors.border }]} />;
}

/** Nom, coordonnées et couleurs d'un client, avec aperçu du bouton aux nouvelles couleurs. */
export function BrandingForm({
  initial,
  onSubmit,
}: {
  initial: BrandingValues;
  onSubmit: (payload: ReturnType<typeof brandingPayload>) => Promise<unknown>;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof BrandingValues) => (text: string) => setValues((v) => ({ ...v, [key]: text }));
  const preview = resolveBranding({ name: values.name, primaryColor: values.primaryColor });

  const submit = async () => {
    const found = validateBranding(values);
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      await onSubmit(brandingPayload(values));
      setMessage({ tone: "ok", text: "Modifications enregistrées." });
    } catch (err) {
      setMessage({ tone: "error", text: formMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.form}>
      <TextField label="Nom affiché" value={values.name} onChangeText={set("name")} error={errors.name} maxLength={191} />
      <TextField label="Adresse" value={values.address} onChangeText={set("address")} error={errors.address} multiline maxLength={500} />
      <TextField label="Téléphone" value={values.phone} onChangeText={set("phone")} error={errors.phone} keyboardType="phone-pad" />
      <TextField
        label="E-mail de contact"
        value={values.email}
        onChangeText={set("email")}
        error={errors.email}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <View style={styles.colors}>
        <View style={styles.color}>
          <TextField
            label="Couleur principale"
            value={values.primaryColor}
            onChangeText={set("primaryColor")}
            error={errors.primaryColor}
            autoCapitalize="characters"
            maxLength={7}
          />
          <Swatch color={values.primaryColor} />
        </View>
        <View style={styles.color}>
          <TextField
            label="Couleur secondaire"
            value={values.secondaryColor}
            onChangeText={set("secondaryColor")}
            error={errors.secondaryColor}
            autoCapitalize="characters"
            maxLength={7}
          />
          <Swatch color={values.secondaryColor} />
        </View>
      </View>
      <View style={[styles.preview, { backgroundColor: preview.primaryColor }]} accessibilityLabel="Aperçu des couleurs">
        <Text style={[styles.previewText, { color: preview.onPrimary }]}>Aperçu : bouton principal</Text>
      </View>
      {message ? (
        <Text style={message.tone === "ok" ? styles.ok : styles.error} accessibilityRole="alert">
          {message.text}
        </Text>
      ) : null}
      <Button label="Enregistrer" onPress={submit} loading={saving} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  colors: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  color: { flexGrow: 1, flexBasis: 200, gap: spacing.xs },
  swatch: { height: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  preview: { borderRadius: radius.md, padding: spacing.md, alignItems: "center" },
  previewText: { fontSize: 15, fontWeight: "600" },
  ok: { fontSize: 14, color: colors.online },
  error: { fontSize: 14, color: colors.danger },
});
