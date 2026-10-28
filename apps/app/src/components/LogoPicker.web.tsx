import { useRef, useState, type ChangeEvent } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/lib/theme";
import { Button } from "./Button";
import type { LogoPickerProps } from "./LogoPicker";

// Mêmes règles que l'API (qui revérifie le contenu réel du fichier).
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 512 * 1024;

/** Web : choix d'un fichier image via le sélecteur du navigateur. */
export function LogoPicker({ onPick, disabled }: LogoPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // permet de choisir à nouveau le même fichier
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return setError("Format non pris en charge : PNG, JPEG ou WebP.");
    if (file.size > MAX_BYTES) return setError("Logo trop lourd : 512 Ko au maximum.");
    setError(null);
    const reader = new FileReader();
    reader.onload = () => void onPick(String(reader.result));
    reader.onerror = () => setError("Lecture du fichier impossible.");
    reader.readAsDataURL(file);
  };

  return (
    <View style={styles.container}>
      <input ref={input} type="file" accept={ACCEPTED.join(",")} onChange={onChange} style={{ display: "none" }} />
      <Button label="Choisir un logo…" variant="secondary" disabled={disabled} onPress={() => input.current?.click()} />
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
  hint: { fontSize: 12, color: colors.muted },
  error: { fontSize: 13, color: colors.danger },
});
