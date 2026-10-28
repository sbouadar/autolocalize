import { Redirect, useRouter } from "expo-router";
import { useMemo, useRef, useState, type ComponentRef } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { PoweredBy } from "@/components/PoweredBy";
import { LoadingState } from "@/components/States";
import { TenantLogo } from "@/components/TenantLogo";
import { TextField } from "@/components/TextField";
import { ApiError, userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { resolveBranding } from "@/lib/branding";
import { BrandingProvider } from "@/lib/branding-context";
import { colors, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { usePublicBranding } from "./public-branding";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginScreen({ slug }: { slug: string | null }) {
  const router = useRouter();
  const { me, loading, signIn } = useAuth();
  const { data: publicBranding, isPending: brandingPending } = usePublicBranding(slug);
  const branding = useMemo(() => resolveBranding(publicBranding), [publicBranding]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  useDocumentTitle(`Connexion — ${branding.name}`);

  if (loading) return <LoadingState />;
  if (me) return <Redirect href="/" />;
  // On évite d'afficher la page AutoLocalize une fraction de seconde avant celle du client.
  if (slug && brandingPending) return <LoadingState />;

  const submit = async () => {
    const errors: typeof fieldErrors = {};
    if (!EMAIL.test(email.trim())) errors.email = "Saisissez une adresse e-mail valide.";
    if (!password) errors.password = "Saisissez votre mot de passe.";
    setFieldErrors(errors);
    setFormError(null);
    if (errors.email || errors.password) return;

    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/");
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.status === 401
          ? "E-mail ou mot de passe incorrect."
          : userMessage(err),
      );
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BrandingProvider value={branding}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.card}>
              <View style={styles.header}>
                <TenantLogo branding={branding} size={72} />
                <Text style={styles.title} accessibilityRole="header">
                  {branding.name}
                </Text>
                <Text style={styles.subtitle}>Connectez-vous pour suivre votre flotte.</Text>
              </View>

              <View style={styles.form}>
                <TextField
                  label="Adresse e-mail"
                  value={email}
                  onChangeText={setEmail}
                  error={fieldErrors.email}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="username"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  editable={!submitting}
                />
                <TextField
                  ref={passwordRef}
                  label="Mot de passe"
                  value={password}
                  onChangeText={setPassword}
                  error={fieldErrors.password}
                  secureTextEntry
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                  editable={!submitting}
                />

                {formError ? (
                  <Text style={styles.formError} accessibilityRole="alert">
                    {formError}
                  </Text>
                ) : null}

                <Button label="Se connecter" onPress={submit} loading={submitting} />
              </View>
            </View>
            <PoweredBy branding={branding} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </BrandingProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.lg },
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.xl,
  },
  header: { alignItems: "center", gap: spacing.sm },
  title: { fontSize: 22, fontWeight: "700", color: colors.text, textAlign: "center" },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: "center" },
  form: { gap: spacing.lg },
  formError: {
    fontSize: 14,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
});
