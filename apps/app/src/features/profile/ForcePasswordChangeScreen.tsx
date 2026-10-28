import { useQueryClient } from "@tanstack/react-query";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TenantLogo } from "@/components/TenantLogo";
import { ME_QUERY_KEY, useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { colors, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { ChangePasswordForm } from "./ChangePasswordForm";

/** Première connexion (ou réinitialisation) : choix d'un mot de passe personnel avant tout accès. */
export function ForcePasswordChangeScreen() {
  const branding = useBranding();
  const { me, signOut } = useAuth();
  const queryClient = useQueryClient();
  useDocumentTitle(`Nouveau mot de passe — ${branding.name}`);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.header}>
              <TenantLogo branding={branding} size={64} />
              <Text style={styles.title} accessibilityRole="header">
                Choisissez votre mot de passe
              </Text>
              <Text style={styles.subtitle}>
                {me?.user.email} — vous utilisez un mot de passe provisoire. Remplacez-le par un mot de passe personnel
                d’au moins 12 caractères pour accéder à votre espace.
              </Text>
            </View>
            <ChangePasswordForm onDone={() => void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })} />
          </View>
          <Pressable accessibilityRole="button" onPress={signOut} hitSlop={8} style={styles.signOut}>
            <Text style={styles.signOutText}>Se déconnecter</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.lg },
  card: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.xl,
  },
  header: { alignItems: "center", gap: spacing.sm },
  title: { fontSize: 20, fontWeight: "700", color: colors.text, textAlign: "center" },
  subtitle: { fontSize: 14, color: colors.muted, textAlign: "center" },
  signOut: { alignSelf: "center", padding: spacing.sm },
  signOutText: { fontSize: 15, color: colors.muted },
});
