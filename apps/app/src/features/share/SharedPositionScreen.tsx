import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { PoweredBy } from "@/components/PoweredBy";
import { ErrorState, LoadingState } from "@/components/States";
import { ApiError, userMessage } from "@/lib/api";
import { PLATFORM_BRANDING } from "@/lib/branding";
import { formatDateTime, formatSpeed, relativeTime } from "@/lib/format";
import { useSharedPosition } from "@/lib/share-links";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import type { PositionedVehicle } from "@/lib/map";
import { VehicleMap } from "../map/VehicleMap";

const noop = () => {};

/** Page publique d'un lien de partage : position du véhicule, sans compte. */
export function SharedPositionScreen({ token }: { token: string }) {
  const { data, isPending, error, refetch } = useSharedPosition(token);
  useDocumentTitle(data ? `${data.vehicleName} — position partagée` : "Position partagée");

  const vehicles = useMemo<PositionedVehicle[]>(() => {
    if (!data?.position) return [];
    const p = data.position;
    return [
      {
        id: "shared",
        name: data.vehicleName,
        plate: null,
        status: data.online ? "online" : data.online === false ? "offline" : "unknown",
        disabled: false,
        lastUpdate: p.fixTime,
        position: { ...p, address: null, ignition: null, motion: p.speedKmh > 2 },
      },
    ];
  }, [data]);

  if (isPending) return <LoadingState />;
  if (!data) {
    const gone = error instanceof ApiError && error.status === 404;
    return gone ? (
      <View style={styles.center}>
        <Text style={styles.title}>Lien expiré</Text>
        <Text style={styles.muted}>Ce lien de partage a expiré, a été désactivé ou n’existe pas. Demandez-en un nouveau.</Text>
        <PoweredBy branding={PLATFORM_BRANDING} />
      </View>
    ) : (
      <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View>
        <Text style={styles.title}>{data.vehicleName}</Text>
        <Text style={styles.muted}>Position partagée · lien valable jusqu’au {formatDateTime(data.expiresAt)}</Text>
      </View>
      {data.position ? (
        <>
          <View style={styles.map}>
            <VehicleMap vehicles={vehicles} selectedId="shared" onSelect={noop} />
          </View>
          <Text style={styles.fact}>
            Position {relativeTime(data.position.fixTime)} ({formatDateTime(data.position.fixTime)}) · {formatSpeed(data.position.speedKmh)}
            {data.online === false ? " · traceur hors ligne" : ""}
          </Text>
        </>
      ) : (
        <Text style={styles.fact}>Position momentanément inconnue.</Text>
      )}
      <PoweredBy branding={PLATFORM_BRANDING} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 900, alignSelf: "center" },
  center: { flex: 1, padding: spacing.xl, gap: spacing.md, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontFamily: fonts.heavy, color: colors.text, textAlign: "left" },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  fact: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  map: { height: 420, borderRadius: radius.xl, overflow: "hidden" },
});
