import { Alert, Platform } from "react-native";

/** Demande de confirmation avant une action sensible (suspension, retrait, réinitialisation). */
export function confirmAction(title: string, message: string, confirmLabel = "Confirmer"): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Annuler", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}
