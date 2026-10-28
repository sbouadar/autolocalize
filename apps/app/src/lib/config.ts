import { Platform } from "react-native";

// Web en production : même origine que le backend (autolocalize.net/api), donc URL relative.
// Natif : URL absolue obligatoire. EXPO_PUBLIC_API_URL surcharge les deux (dev local).
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : "https://autolocalize.net");

/** Fréquence de rafraîchissement des positions (en attendant le temps réel par WebSocket). */
export const VEHICLES_REFRESH_MS = 10_000;

// Fond de carte web (Leaflet). Les serveurs d'OpenStreetMap conviennent au développement mais leur
// politique d'usage exclut un service commercial à fort trafic : prévoir un fournisseur de tuiles
// (MapTiler, Stadia, auto-hébergé…) avant l'ouverture aux clients. Natif : Apple Maps / Google Maps.
export const MAP_TILE_URL =
  process.env.EXPO_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_ATTRIBUTION =
  process.env.EXPO_PUBLIC_MAP_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
