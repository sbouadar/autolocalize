import { StyleSheet, Text } from "react-native";
import { colors } from "@/lib/theme";

export interface LogoPickerProps {
  /** Image choisie, en data URL base64 (contrôlée ensuite par l'API). */
  onPick: (dataUrl: string) => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Mobile : le téléversement du logo passe par la version web (le choix d'une image sur le
 * téléphone demanderait le module expo-image-picker, non installé). Voir LogoPicker.web.tsx.
 */
export function LogoPicker(_props: LogoPickerProps) {
  return <Text style={styles.note}>Le logo se modifie depuis la version web de l’application.</Text>;
}

const styles = StyleSheet.create({
  note: { fontSize: 13, color: colors.muted },
});
