import { useLocalSearchParams } from "expo-router";
import { LoginScreen } from "@/features/auth/LoginScreen";

/** /login/<slug> : page de connexion aux couleurs du client. */
export default function TenantLoginRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <LoginScreen slug={typeof slug === "string" ? slug.toLowerCase() : null} />;
}
