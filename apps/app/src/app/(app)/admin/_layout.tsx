import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/lib/auth";
import { colors } from "@/lib/theme";

/**
 * Back-office réservé au super-admin. Ce garde n'est qu'un confort d'interface :
 * la sécurité est assurée par l'API (403 sur /admin/* pour tout autre rôle).
 */
export default function AdminLayout() {
  const { me } = useAuth();
  if (me?.user.role !== "SUPER_ADMIN") return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
