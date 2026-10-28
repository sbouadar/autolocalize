import { LoadingState } from "@/components/States";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { useLastSlug } from "@/features/auth/public-branding";

/** /login : branding du dernier client utilisé sur cet appareil, sinon AutoLocalize. */
export default function LoginRoute() {
  const { slug, ready } = useLastSlug();
  if (!ready) return <LoadingState />;
  return <LoginScreen slug={slug} />;
}
