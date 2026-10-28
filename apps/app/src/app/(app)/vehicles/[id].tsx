import { useLocalSearchParams } from "expo-router";
import { VehicleDetailScreen } from "@/features/vehicle/VehicleDetailScreen";

export default function VehicleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // key : repartir d'un état vierge (période, trajet choisi) en changeant de véhicule.
  return <VehicleDetailScreen key={id} id={String(id)} />;
}
