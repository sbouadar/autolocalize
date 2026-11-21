// CSS global de la carte web (Leaflet) : ignoré automatiquement sur iOS et Android.
import "leaflet/dist/leaflet.css";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/manrope";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/lib/auth";
import { createQueryClient } from "@/lib/query-client";

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  // Les noms des fichiers sont ceux utilisés par `fonts` dans lib/theme.ts ; la police des icônes
  // est chargée en même temps pour que les icônes (onglets, marqueurs) s'affichent dès le départ.
  const [fontsLoaded, fontError] = useFonts({
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    ...MaterialCommunityIcons.font,
  });

  // Rien avant les polices, pour éviter un premier affichage en police système. Si leur
  // chargement échoue, l'app s'affiche quand même (police système).
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
