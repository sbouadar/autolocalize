import { useEffect } from "react";
import { Platform } from "react-native";

/** Titre de l'onglet du navigateur (sans effet sur mobile). */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") document.title = title;
  }, [title]);
}
