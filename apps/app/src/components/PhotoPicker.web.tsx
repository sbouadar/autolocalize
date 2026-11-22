import { useRef, useState, type ChangeEvent } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, spacing } from "@/lib/theme";
import { Button } from "./Button";
import type { PhotoPickerProps } from "./PhotoPicker";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
/** Plus grand côté envoyé : la photo est réduite dans le navigateur pour un envoi rapide. */
const MAX_SIDE = 1920;

/** Réduit l'image et la réencode en JPEG (ce qui retire aussi ses métadonnées). */
function downscale(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * ratio);
      canvas.height = Math.round(image.height * ratio);
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("canvas"));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    image.src = url;
  });
}

/** Web : appareil photo du téléphone (attribut capture) ou fichier de l'ordinateur. */
export function PhotoPicker({ onPick, disabled }: PhotoPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const onChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // permet de reprendre la même photo
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return setError("Format non pris en charge : JPEG, PNG ou WebP.");
    setError(null);
    try {
      await onPick(await downscale(file));
    } catch {
      setError("Cette photo n’a pas pu être lue.");
    }
  };

  return (
    <View style={styles.container}>
      <input ref={input} type="file" accept={ACCEPTED.join(",")} capture="environment" onChange={(e) => void onChange(e)} style={{ display: "none" }} />
      <Button label="Ajouter une photo" variant="secondary" disabled={disabled} onPress={() => input.current?.click()} />
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
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
});
