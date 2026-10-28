import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { colors, spacing } from "@/lib/theme";
import { TenantLogo } from "./TenantLogo";

/** En-tête aux couleurs du client : logo, nom, déconnexion (et back-office pour le super-admin). */
export function AppHeader() {
  const branding = useBranding();
  const router = useRouter();
  const { me, signOut } = useAuth();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm, borderBottomColor: branding.primaryColor }]}>
      <View style={styles.identity}>
        <TenantLogo branding={branding} size={36} />
        <Text style={styles.name} numberOfLines={1}>
          {branding.name}
        </Text>
      </View>
      <View style={styles.links}>
        {me?.user.role === "SUPER_ADMIN" ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.navigate("/admin")}
            hitSlop={8}
            style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.signOutText, { color: branding.primaryColor }]}>Administration</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Se déconnecter"
          onPress={signOut}
          hitSlop={8}
          style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.signOutText, { color: branding.primaryColor }]}>Déconnexion</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 3,
  },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexShrink: 1 },
  name: { fontSize: 17, fontWeight: "700", color: colors.text, flexShrink: 1 },
  links: { flexDirection: "row", alignItems: "center" },
  signOut: { paddingVertical: spacing.sm, paddingLeft: spacing.md },
  signOutText: { fontSize: 15, fontWeight: "600" },
});
