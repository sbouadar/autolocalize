import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { Tabs } from "expo-router/js-tabs";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { colors, fonts } from "@/lib/theme";

/**
 * Onglets de l'espace client. L'en-tête du client vient de la pile parente ((app)/_layout.tsx) ;
 * icônes de Material Design Icons (@expo/vector-icons), pleines pour l'onglet actif.
 */
type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

function tabIcon(outline: IconName, filled: IconName) {
  // Les teintes des onglets sont données en chaînes (#RRGGBB) : la couleur reçue en est toujours une.
  function TabIcon({ color, focused }: { color: ColorValue | null; focused: boolean }) {
    return <MaterialCommunityIcons name={focused ? filled : outline} size={24} color={typeof color === "string" ? color : undefined} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const branding = useBranding();
  // Onglet « Locations » : seulement pour un client dont le module location est activé.
  const rentalsEnabled = useAuth().me?.tenant?.rentalsEnabled === true;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: branding.primaryText,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.bold },
        tabBarStyle: { borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Tableau de bord", tabBarLabel: "Accueil", tabBarIcon: tabIcon("view-dashboard-outline", "view-dashboard") }} />
      <Tabs.Screen name="map" options={{ title: "Carte", tabBarIcon: tabIcon("map-marker-outline", "map-marker") }} />
      <Tabs.Screen
        name="rentals"
        options={{
          title: "Locations",
          tabBarIcon: tabIcon("calendar-month-outline", "calendar-month"),
          tabBarItemStyle: rentalsEnabled ? undefined : { display: "none" },
        }}
      />
      <Tabs.Screen name="alerts" options={{ title: "Alertes", tabBarIcon: tabIcon("bell-outline", "bell") }} />
      <Tabs.Screen name="profile" options={{ title: "Profil", tabBarIcon: tabIcon("account-outline", "account") }} />
    </Tabs>
  );
}
