import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { TextField } from "@/components/TextField";
import { slugify, useCreateTenant, type Credentials } from "@/lib/admin";
import { formMessage } from "@/lib/api";
import { colors, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { CredentialsCard } from "./CredentialsCard";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Fields {
  name: string;
  slug: string;
  address: string;
  phone: string;
  email: string;
  adminName: string;
  adminEmail: string;
}
type Errors = Partial<Record<keyof Fields, string>>;

export function validateNewTenant(f: Fields): Errors {
  const errors: Errors = {};
  if (!f.name.trim()) errors.name = "Le nom est obligatoire.";
  if (f.slug.length < 2 || f.slug.length > 64 || !SLUG.test(f.slug)) {
    errors.slug = "2 à 64 caractères : minuscules, chiffres et tirets (pas au début ni à la fin).";
  }
  if (f.email.trim() && !EMAIL.test(f.email.trim())) errors.email = "Adresse e-mail invalide.";
  if (!f.adminName.trim()) errors.adminName = "Le nom du titulaire du compte est obligatoire.";
  if (!EMAIL.test(f.adminEmail.trim())) errors.adminEmail = "Adresse e-mail invalide.";
  return errors;
}

/** Création d'un client et de son compte unique ; affiche une seule fois les identifiants provisoires. */
export function NewTenantScreen() {
  useDocumentTitle("Nouveau client — AutoLocalize");
  const router = useRouter();
  const create = useCreateTenant();
  const [fields, setFields] = useState<Fields>({
    name: "",
    slug: "",
    address: "",
    phone: "",
    email: "",
    adminName: "",
    adminEmail: "",
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; slug: string; credentials: Credentials } | null>(null);

  const set = (key: keyof Fields) => (value: string) =>
    setFields((f) => ({ ...f, [key]: value, ...(key === "name" && !slugTouched ? { slug: slugify(value) } : {}) }));

  const submit = async () => {
    const found = validateNewTenant(fields);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    const orNull = (s: string) => (s.trim() ? s.trim() : null);
    try {
      const result = await create.mutateAsync({
        slug: fields.slug,
        name: fields.name.trim(),
        address: orNull(fields.address),
        phone: orNull(fields.phone),
        email: orNull(fields.email),
        admin: { name: fields.adminName.trim(), email: fields.adminEmail.trim() },
      });
      setCreated({ id: result.tenant.id, slug: result.tenant.slug, credentials: result.admin });
      // Le mot de passe provisoire ne doit vivre que dans l'état de cet écran.
      create.reset();
    } catch (err) {
      setFormError(formMessage(err));
    }
  };

  if (created) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.title}>Client créé</Text>
        <CredentialsCard credentials={created.credentials} slug={created.slug} />
        <Button
          label="Ouvrir la fiche du client (traceurs, logo…)"
          onPress={() => router.replace({ pathname: "/admin/tenants/[id]", params: { id: created.id } })}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Nouveau client
      </Text>
      <Card title="Société">
        <TextField label="Nom" value={fields.name} onChangeText={set("name")} error={errors.name} maxLength={191} />
        <TextField
          label="Identifiant (adresse de connexion /login/…)"
          value={fields.slug}
          onChangeText={(v) => {
            setSlugTouched(true);
            set("slug")(v.toLowerCase());
          }}
          error={errors.slug}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={64}
        />
        <TextField label="Adresse" value={fields.address} onChangeText={set("address")} multiline maxLength={500} />
        <TextField label="Téléphone" value={fields.phone} onChangeText={set("phone")} keyboardType="phone-pad" />
        <TextField
          label="E-mail de contact"
          value={fields.email}
          onChangeText={set("email")}
          error={errors.email}
          autoCapitalize="none"
          keyboardType="email-address"
        />
      </Card>
      <Card title="Compte du client">
        <Text style={styles.muted}>
          Un seul compte par client pour l’instant. Un mot de passe provisoire est généré ; il sera à changer à la première
          connexion.
        </Text>
        <TextField label="Nom du titulaire" value={fields.adminName} onChangeText={set("adminName")} error={errors.adminName} />
        <TextField
          label="E-mail de connexion"
          value={fields.adminEmail}
          onChangeText={set("adminEmail")}
          error={errors.adminEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
      </Card>
      {formError ? (
        <Text style={styles.error} accessibilityRole="alert">
          {formError}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button label="Annuler" variant="secondary" onPress={() => router.back()} />
        <Button label="Créer le client" onPress={submit} loading={create.isPending} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, width: "100%", maxWidth: 720, alignSelf: "center" },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  error: { fontSize: 14, color: colors.danger, backgroundColor: colors.dangerSoft, padding: spacing.md, borderRadius: radius.sm },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
