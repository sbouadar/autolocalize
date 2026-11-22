import { useLocalSearchParams } from "expo-router";
import { DriverDetailScreen } from "@/features/drivers/DriverDetailScreen";

export default function DriverRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DriverDetailScreen id={id} />;
}
