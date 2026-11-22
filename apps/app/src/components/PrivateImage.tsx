import { Image, type ImageStyle } from "expo-image";
import { useEffect, useState } from "react";
import { Platform, type StyleProp } from "react-native";
import { apiUrl, authHeaders } from "@/lib/api";

interface PrivateImageProps {
  /** Chemin relatif à l'API (ex. /rentals/<id>/photos/<id>). */
  path: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel: string;
}

/**
 * Image servie par une route privée de l'API. Web : le cookie de session de même origine suffit.
 * Mobile : le jeton de session est joint à la requête de l'image.
 */
export function PrivateImage({ path, style, accessibilityLabel }: PrivateImageProps) {
  const [headers, setHeaders] = useState<Record<string, string> | null>(Platform.OS === "web" ? {} : null);
  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    void authHeaders().then((h) => {
      if (!cancelled) setHeaders(h);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (!headers) return null;
  return (
    <Image
      source={{ uri: apiUrl(path), headers }}
      style={style}
      contentFit="cover"
      accessibilityLabel={accessibilityLabel}
      // Fichier privé : pas de copie sur le disque de l'appareil.
      cachePolicy="memory"
    />
  );
}
