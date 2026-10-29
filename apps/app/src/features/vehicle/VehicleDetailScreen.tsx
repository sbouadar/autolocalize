import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { StatTile } from "@/components/StatTile";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/States";
import { ApiError, userMessage } from "@/lib/api";
import { useBranding } from "@/lib/branding-context";
import { formatCoordinates, formatDateTime, formatDistance, formatDuration, formatSpeed } from "@/lib/format";
import { PERIODS, periodRange, type PeriodKey } from "@/lib/period";
import type { ReplayFrame } from "@/lib/replay";
import type { Place } from "@/lib/types";
import { colors, radius, spacing } from "@/lib/theme";
import { pointsDuring, tripTotals } from "@/lib/trips";
import { useDocumentTitle } from "@/lib/use-document-title";
import {
  hasPosition,
  ignitionLabel,
  lastSeen,
  movementLabel,
  useRoute,
  useTrips,
  useVehicle,
  vehicleLabel,
  vehicleStatus,
} from "@/lib/vehicles";
import { VehicleMap } from "../map/VehicleMap";
import { EngineCard } from "./EngineCard";
import { ReplayControls } from "./ReplayControls";
import { TripList } from "./TripList";

const noop = () => {};

/** Adresse du lieu, ou ses coordonnées tant qu'elle n'est pas connue. */
function placeLabel(place: Place): string {
  return place.address ?? formatCoordinates(place.latitude, place.longitude);
}
const NO_VEHICLES: never[] = [];

function BackLink() {
  const router = useRouter();
  const branding = useBranding();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      hitSlop={8}
      style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.backText, { color: branding.primaryColor }]}>‹ Retour</Text>
    </Pressable>
  );
}

/** Fiche véhicule : état courant, carte, trajets et tracé de la période choisie. */
export function VehicleDetailScreen({ id }: { id: string }) {
  const branding = useBranding();
  const vehicleQuery = useVehicle(id);
  const [periodKey, setPeriodKey] = useState<PeriodKey>("today");
  const [selectedTrip, setSelectedTrip] = useState<number | null>(null);
  // Période figée au moment du choix : la clé de cache reste stable entre deux rendus.
  const range = useMemo(() => periodRange(periodKey), [periodKey]);
  const tripsQuery = useTrips(id, range);
  const routeQuery = useRoute(id, range);

  const vehicle = vehicleQuery.data?.vehicle;
  useDocumentTitle(`${vehicle ? vehicleLabel(vehicle) : "Véhicule"} — ${branding.name}`);

  const trips = useMemo(() => tripsQuery.data?.trips ?? [], [tripsQuery.data]);
  const totals = useMemo(() => tripTotals(trips), [trips]);
  const route = useMemo(() => {
    const points = routeQuery.data?.points ?? [];
    const trip = selectedTrip != null ? trips[selectedTrip] : undefined;
    return trip ? pointsDuring(points, trip) : points;
  }, [routeQuery.data, trips, selectedTrip]);
  const mapVehicles = useMemo(() => (vehicle && hasPosition(vehicle) ? [vehicle] : []), [vehicle]);
  const [replaying, setReplaying] = useState(false);
  const [frame, setFrame] = useState<ReplayFrame | null>(null);
  // Le replay repart du début dès que le tracé change (autre trajet, autre période).
  const routeKey = `${route.length}-${route[0]?.fixTime ?? ""}-${route.at(-1)?.fixTime ?? ""}`;

  const changePeriod = (key: PeriodKey) => {
    setPeriodKey(key);
    setSelectedTrip(null);
    setReplaying(false);
  };

  if (vehicleQuery.isPending) return <LoadingState />;
  if (!vehicle) {
    const notFound = vehicleQuery.error instanceof ApiError && vehicleQuery.error.status === 404;
    return (
      <View style={styles.flex}>
        <View style={styles.page}>
          <BackLink />
        </View>
        {notFound ? (
          <EmptyState title="Véhicule introuvable" message="Ce véhicule n’existe pas ou n’est plus rattaché à votre compte." />
        ) : (
          <ErrorState message={userMessage(vehicleQuery.error)} onRetry={() => void vehicleQuery.refetch()} />
        )}
      </View>
    );
  }

  const status = vehicleStatus(vehicle);
  const p = vehicle.position;
  const facts = [
    movementLabel(p),
    ignitionLabel(p?.ignition),
    p ? (p.address ?? formatCoordinates(p.latitude, p.longitude)) : null,
    `Dernière information : ${formatDateTime(lastSeen(vehicle))}`,
  ].filter((line): line is string => Boolean(line));

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <BackLink />

      <View style={styles.card}>
        <Text style={styles.title}>{vehicleLabel(vehicle)}</Text>
        {vehicle.plate && vehicle.plate !== vehicle.name ? <Text style={styles.muted}>{vehicle.plate}</Text> : null}
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: status.color }]} />
          <Text style={styles.statusText}>{status.label}</Text>
        </View>
        {facts.map((line) => (
          <Text key={line} style={styles.fact}>
            {line}
          </Text>
        ))}
      </View>

      <EngineCard vehicle={vehicle} />

      {vehicleQuery.data?.liveDataAvailable === false ? (
        <Banner message="Suivi en direct momentanément indisponible : position et statut ne peuvent pas être affichés." />
      ) : null}

      <View style={styles.map}>
        <VehicleMap
          vehicles={replaying ? NO_VEHICLES : mapVehicles}
          selectedId={null}
          onSelect={noop}
          route={route}
          cursor={replaying ? frame : null}
        />
      </View>
      {replaying ? (
        <ReplayControls
          key={routeKey}
          points={route}
          withDay={periodKey === "week"}
          onFrame={setFrame}
          onClose={() => setReplaying(false)}
        />
      ) : route.length > 1 ? (
        <Button
          label={selectedTrip != null ? "Rejouer ce trajet" : "Rejouer la période"}
          variant="secondary"
          onPress={() => setReplaying(true)}
        />
      ) : null}

      <Text style={styles.section}>Historique</Text>
      <SegmentedControl options={PERIODS} value={periodKey} onChange={changePeriod} />

      {tripsQuery.isPending ? (
        <ActivityIndicator color={branding.primaryColor} style={styles.loader} accessibilityLabel="Chargement des trajets" />
      ) : tripsQuery.isError ? (
        <ErrorState message={userMessage(tripsQuery.error)} onRetry={() => void tripsQuery.refetch()} />
      ) : (
        <>
          <View style={styles.tiles}>
            <StatTile label="Trajets" value={String(totals.count)} />
            <StatTile label="Distance" value={formatDistance(totals.distanceKm)} />
            <StatTile label="Temps de conduite" value={formatDuration(totals.durationMs)} />
            <StatTile label="Vitesse max" value={formatSpeed(totals.maxSpeedKmh)} />
          </View>
          {tripsQuery.data?.departure && tripsQuery.data.arrival ? (
            <View style={styles.card}>
              <Text style={styles.fact}>Départ : {placeLabel(tripsQuery.data.departure)}</Text>
              <Text style={styles.fact}>Arrivée : {placeLabel(tripsQuery.data.arrival)}</Text>
            </View>
          ) : null}
          {trips.length === 0 ? (
            <Text style={styles.empty}>Aucun trajet sur cette période.</Text>
          ) : (
            <TripList trips={trips} selectedIndex={selectedTrip} onSelect={setSelectedTrip} withDay={periodKey === "week"} />
          )}
        </>
      )}
      {routeQuery.data?.truncated ? (
        <Text style={styles.muted}>Tracé simplifié : trop de positions sur cette période pour toutes les afficher.</Text>
      ) : null}
      {routeQuery.isError ? <Banner message="Le tracé de la période n’a pas pu être chargé." /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 900, alignSelf: "center" },
  back: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  backText: { fontSize: 16, fontWeight: "600" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  status: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginVertical: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 15, fontWeight: "600", color: colors.text },
  fact: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  map: { height: 320, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  section: { fontSize: 18, fontWeight: "700", color: colors.text, marginTop: spacing.sm },
  loader: { marginVertical: spacing.xl },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  empty: { fontSize: 15, color: colors.muted, textAlign: "center", marginVertical: spacing.lg },
});
