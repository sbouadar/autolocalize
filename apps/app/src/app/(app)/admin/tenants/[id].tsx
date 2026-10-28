import { useLocalSearchParams } from "expo-router";
import { TenantDetailScreen } from "@/features/admin/TenantDetailScreen";

export default function TenantRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // key : état vierge (identifiants affichés, formulaires) en changeant de client.
  return <TenantDetailScreen key={id} id={String(id)} />;
}
