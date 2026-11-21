import { useLocalSearchParams } from "expo-router";
import { RentalDetailScreen } from "@/features/rentals/RentalDetailScreen";

export default function RentalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RentalDetailScreen key={id} id={String(id)} />;
}
