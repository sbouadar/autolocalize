import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, spacing } from "@/lib/theme";
import { Button } from "./Button";

export interface LogoPickerProps {
  /** Image choisie, en data URL base64 (contrôlée ensuite par l'API). */
  onPick: (dataUrl: string) => void | Promise<void>;
  disabled?: boolean;
}

// Mêmes règles que l'API (qui revérifie le contenu réel du fichier).
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 512 * 1024;

/** Taille réelle d'un contenu base64 (sans les caractères de remplissage). */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Mobile : choix d'une image dans la galerie (expo-image-picker). L'image est envoyée telle quelle,
 * sans recadrage ni recompression, pour garder la transparence d'un PNG. Voir LogoPicker.web.tsx.
 */
export function LogoPicker({ onPick, disabled }: LogoPickerProps) {
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, exif: false });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      const type = asset.mimeType ?? "";
      if (!ACCEPTED.includes(type)) return setError("Format non pris en charge : PNG, JPEG ou WebP.");
      if (!asset.base64) return setError("Cette image n’a pas pu être lue.");
      if (base64Bytes(asset.base64) > MAX_BYTES) return setError("Logo trop lourd : 512 Ko au maximum.");
      await onPick(`data:${type};base64,${asset.base64}`);
    } catch {
      setError("Le logo n’a pas pu être choisi.");
    }
  };

  return (
    <View style={styles.container}>
      <Button label="Choisir un logo…" variant="secondary" disabled={disabled} onPress={() => void pick()} />
      <Text style={styles.hint}>PNG, JPEG ou WebP, 512 Ko au maximum. Fond transparent conseillé.</Text>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
});
