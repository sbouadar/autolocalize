import { Tabs } from "expo-router/js-tabs";
import { useBranding } from "@/lib/branding-context";
import { colors, fonts } from "@/lib/theme";

/**
 * Onglets de l'espace client. L'en-tête du client vient de la pile parente ((app)/_layout.tsx) ;
 * les onglets n'ont pas d'icône pour éviter une dépendance d'icônes en plus.
 */
export default function TabsLayout() {
  const branding = useBranding();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: branding.primaryText,
        tabBarInactiveTintColor: colors.muted,
        tabBarIcon: () => null,
        tabBarIconStyle: { display: "none" },
        tabBarLabelStyle: { fontSize: 15, fontFamily: fonts.bold },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Tableau de bord" }} />
      <Tabs.Screen name="map" options={{ title: "Carte" }} />
      <Tabs.Screen name="alerts" options={{ title: "Alertes" }} />
      <Tabs.Screen name="profile" options={{ title: "Profil" }} />
    </Tabs>
  );
}
