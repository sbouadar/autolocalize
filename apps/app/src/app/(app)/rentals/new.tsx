import { useLocalSearchParams } from "expo-router";
import { NewRentalScreen } from "@/features/rentals/NewRentalScreen";

/** `?vehicleId=` : ouverture depuis la fiche d'un véhicule, proposé d'office s'il est libre. */
export default function NewRentalRoute() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId?: string }>();
  return <NewRentalScreen preferredVehicleId={typeof vehicleId === "string" ? vehicleId : undefined} />;
}
