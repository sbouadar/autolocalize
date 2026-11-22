import { useLocalSearchParams } from "expo-router";
import { SharedPositionScreen } from "@/features/share/SharedPositionScreen";

/** Lien de partage public : hors de l'espace connecté, aucune session requise. */
export default function SharedPositionRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <SharedPositionScreen token={String(token)} />;
}
