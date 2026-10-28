import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Web : localStorage (peut être indisponible en navigation privée) ; natif : trousseau sécurisé.
export const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },

  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // stockage indisponible : simple confort perdu
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },

  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // idem
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

export const STORAGE_KEYS = {
  /** Jeton de session (natif uniquement ; le web utilise le cookie). */
  sessionToken: "al.session_token",
  /** Dernier client utilisé : personnalise /login sans slug. */
  lastSlug: "al.last_slug",
} as const;
