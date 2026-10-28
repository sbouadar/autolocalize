import { StyleSheet, Text } from "react-native";
import { PLATFORM_NAME, type Branding } from "@/lib/branding";
import { colors } from "@/lib/theme";

/** Mention de la plateforme sous le branding d'un client (masquable plus tard depuis le BO). */
export function PoweredBy({ branding }: { branding: Branding }) {
  if (branding.isPlatform || branding.hidePoweredBy) return null;
  return <Text style={styles.text}>Propulsé par {PLATFORM_NAME}</Text>;
}

const styles = StyleSheet.create({
  text: { fontSize: 12, color: colors.muted, textAlign: "center" },
});
