import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, spacing } from "@/lib/theme";
import { Button } from "./Button";

export interface PhotoPickerProps {
  /** Photo choisie, en data URL base64 (vérifiée et réencodée ensuite par l'API). */
  onPick: (dataUrl: string) => void | Promise<void>;
  disabled?: boolean;
}

/** Qualité JPEG demandée à l'appareil : assez pour un état des lieux, envoi rapide même en sous-sol. */
const QUALITY = 0.6;

/** Mobile : prise de vue ou choix dans la galerie (expo-image-picker). Voir PhotoPicker.web.tsx. */
export function PhotoPicker({ onPick, disabled }: PhotoPickerProps) {
  const [error, setError] = useState<string | null>(null);

  const pick = async (source: "camera" | "library") => {
    setError(null);
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) return setError("Autorisez l’appareil photo dans les réglages du téléphone pour prendre une photo.");
      }
      const options = { mediaTypes: ["images" as const], quality: QUALITY, base64: true, exif: false };
      const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      if (!asset.base64) return setError("Cette photo n’a pas pu être lue.");
      await onPick(`data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`);
    } catch {
      setError("La photo n’a pas pu être ajoutée.");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button label="Prendre une photo" variant="secondary" disabled={disabled} onPress={() => void pick("camera")} />
        </View>
        <View style={styles.flex}>
          <Button label="Galerie" variant="secondary" disabled={disabled} onPress={() => void pick("library")} />
        </View>
      </View>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { gap: spacing.xs },
  row: { flexDirection: "row", gap: spacing.sm },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
});
