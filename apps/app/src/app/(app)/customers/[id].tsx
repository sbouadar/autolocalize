import { useLocalSearchParams } from "expo-router";
import { CustomerDetailScreen } from "@/features/rentals/CustomerDetailScreen";

export default function CustomerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // key : les numéros complets affichés pour un locataire ne survivent pas au passage à un autre.
  return <CustomerDetailScreen key={id} id={String(id)} />;
}
