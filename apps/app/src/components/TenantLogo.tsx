import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Branding } from "@/lib/branding";
import { API_URL } from "@/lib/config";

interface TenantLogoProps {
  branding: Branding;
  size?: number;
}

/** Logo du client ; à défaut (absent ou en erreur de chargement), ses initiales sur sa couleur. */
export function TenantLogo({ branding, size = 48 }: TenantLogoProps) {
  // On retient l'URL en échec plutôt qu'un booléen : un nouveau logo est retenté sans effet.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (branding.logoUrl && branding.logoUrl !== failedUrl) {
    const uri = branding.logoUrl.startsWith("/") ? `${API_URL}${branding.logoUrl}` : branding.logoUrl;
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size }}
        contentFit="contain"
        accessibilityLabel={`Logo ${branding.name}`}
        onError={() => setFailedUrl(branding.logoUrl)}
      />
    );
  }

  return (
    <View
      accessibilityLabel={`Logo ${branding.name}`}
      accessibilityRole="image"
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 4, backgroundColor: branding.primaryColor },
      ]}
    >
      <Text style={[styles.initials, { color: branding.onPrimary, fontSize: size * 0.4 }]}>
        {branding.initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", justifyContent: "center" },
  initials: { fontWeight: "700" },
});
