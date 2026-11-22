import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { StatTile } from "@/components/StatTile";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/States";
import { ApiError, userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { formatCoordinates, formatDateTime, formatDistance, formatDuration, formatSpeed, relativeTime } from "@/lib/format";
import { PERIODS, type PeriodKey } from "@/lib/period";
import type { ReplayFrame } from "@/lib/replay";
import type { Place } from "@/lib/types";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { pointsDuring, tripTotals } from "@/lib/trips";
import { useDocumentTitle } from "@/lib/use-document-title";
import { hasPosition, lastSeen, useRoute, useTrips, useVehicle, vehicleLabel, vehicleState } from "@/lib/vehicles";
import { useZones } from "@/lib/zones";
import { VehicleMap } from "../map/VehicleMap";
import { DeadlinesCard } from "./DeadlinesCard";
import { EngineCard } from "./EngineCard";
import { MaintenanceCard } from "./MaintenanceCard";
import { OdometerCard } from "./OdometerCard";
import { RentalsCard } from "./RentalsCard";
import { ReplayControls } from "./ReplayControls";
import { TripList } from "./TripList";
import { UnavailabilityCard } from "./UnavailabilityCard";
import { VehicleInfoCard } from "./VehicleInfoCard";

const noop = () => {};

/** Adresse du lieu, ou ses coordonnées tant qu'elle n'est pas connue. */
function placeLabel(place: Place): string {
  return place.address ?? formatCoordinates(place.latitude, place.longitude);
}
const NO_VEHICLES: never[] = [];

function BackLink() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Retour"
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      hitSlop={8}
      style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
    >
      <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
    </Pressable>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label} : ${value}`}>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

/** Fiche véhicule : état courant, carte, trajets et tracé de la période choisie. */
export function VehicleDetailScreen({ id }: { id: string }) {
  const branding = useBranding();
  const vehicleQuery = useVehicle(id);
  // Fiche et relevés modifiables par l'admin du client (et le super-admin connecté en tant que lui).
  const me = useAuth().me;
  const role = me?.user.role;
  const rentalsEnabled = me?.tenant?.rentalsEnabled === true && role !== "SUPER_ADMIN";
  const canEdit = role === "TENANT_ADMIN";
  // Les agents saisissent les relevés de compteur (départs et retours de location à venir).
  const canAddReading = canEdit || role === "AGENT"; // vaut aussi pour les indisponibilités
  const [periodKey, setPeriodKey] = useState<PeriodKey>("today");
  const [selectedTrip, setSelectedTrip] = useState<number | null>(null);
  const tripsQuery = useTrips(id, periodKey);
  const routeQuery = useRoute(id, periodKey);

  const vehicle = vehicleQuery.data?.vehicle;
  useDocumentTitle(`${vehicle ? vehicleLabel(vehicle) : "Véhicule"} — ${branding.name}`);

  const trips = useMemo(() => tripsQuery.data?.trips ?? [], [tripsQuery.data]);
  const totals = useMemo(() => tripTotals(trips), [trips]);
  const route = useMemo(() => {
    const points = routeQuery.data?.points ?? [];
    const trip = selectedTrip != null ? trips[selectedTrip] : undefined;
    return trip ? pointsDuring(points, trip) : points;
  }, [routeQuery.data, trips, selectedTrip]);
  // Zones qui surveillent ce véhicule : dessinées sur sa carte (masquables).
  const zonesData = useZones().data;
  const watchingZones = useMemo(() => (zonesData?.zones ?? []).filter((z) => z.vehicleIds.includes(id)), [zonesData, id]);
  const [showZones, setShowZones] = useState(true);
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

  const state = vehicleState(vehicle);
  const p = vehicle.position;
  // Vitesse actuelle seulement pour un traceur en ligne : hors ligne, la dernière vitesse est périmée.
  const speed = !p ? "—" : state.key === "moving" ? formatSpeed(p.speedKmh) : state.key === "stopped" ? formatSpeed(0) : "—";
  const ignition = p?.ignition == null ? "—" : p.ignition ? "Mis" : "Coupé";
  const place = p ? (p.address ?? formatCoordinates(p.latitude, p.longitude)) : "Position inconnue";

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <BackLink />
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {vehicleLabel(vehicle)}
          </Text>
          {vehicle.plate && vehicle.plate !== vehicle.name ? <Text style={styles.muted}>{vehicle.plate}</Text> : null}
        </View>
      </View>

      <View style={[styles.banner, { backgroundColor: state.color }]} accessible accessibilityLabel={`État : ${state.label}`}>
        <View style={styles.bannerState}>
          <MaterialCommunityIcons name="car" size={20} color={colors.onDark} />
          <Text style={styles.bannerLabel}>{state.label}</Text>
        </View>
        <Text style={styles.bannerTime}>mis à jour {relativeTime(lastSeen(vehicle))}</Text>
      </View>

      <View style={styles.tilesRow}>
        <Tile label="Vitesse actuelle" value={speed} />
        <Tile label="Contact" value={ignition} />
        <Tile label="Dernière position" value={formatDateTime(lastSeen(vehicle))} />
      </View>

      <View style={styles.place}>
        <MaterialCommunityIcons name="map-marker" size={18} color={colors.text} />
        <Text style={styles.placeText}>{place}</Text>
      </View>

      <EngineCard vehicle={vehicle} />
      <OdometerCard vehicleId={vehicle.id} canAdd={canAddReading} canDelete={canEdit} />

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
          zones={showZones ? watchingZones : undefined}
        />
      </View>
      {watchingZones.length > 0 ? (
        <View style={styles.zonesRow}>
          <MaterialCommunityIcons name="map-marker-radius-outline" size={18} color={colors.muted} />
          <Text style={[styles.muted, styles.flex]} numberOfLines={2}>
            Zones surveillées : {watchingZones.map((z) => z.name).join(", ")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showZones ? "Masquer les zones sur la carte" : "Afficher les zones sur la carte"}
            onPress={() => setShowZones((v) => !v)}
            hitSlop={8}
            style={({ pressed }) => [styles.zonesToggle, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.zonesToggleText}>{showZones ? "Masquer" : "Afficher"}</Text>
          </Pressable>
        </View>
      ) : null}
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
        <ActivityIndicator color={branding.primaryText} style={styles.loader} accessibilityLabel="Chargement des trajets" />
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
            <View style={styles.places}>
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

      <Text style={styles.section}>Gestion du véhicule</Text>
      {rentalsEnabled ? <RentalsCard vehicleId={vehicle.id} canBook={canAddReading} /> : null}
      <UnavailabilityCard vehicleId={vehicle.id} canEdit={canAddReading} />
      <MaintenanceCard vehicleId={vehicle.id} canEdit={canEdit} canRecord={canAddReading} />
      <DeadlinesCard vehicleId={vehicle.id} canEdit={canEdit} />
      <VehicleInfoCard vehicle={vehicle} canEdit={canEdit} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 900, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  back: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.fill,
  },
  title: { fontSize: 22, fontFamily: fonts.heavy, letterSpacing: -0.4, color: colors.text },
  // Bandeau d'état : couleur fixe de l'état (jamais celle du client), texte blanc.
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderCurve: "continuous",
  },
  bannerState: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  bannerLabel: { fontFamily: fonts.heavy, fontSize: 17, color: colors.onDark },
  bannerTime: { fontFamily: fonts.medium, fontSize: 13, color: colors.onDark },
  tilesRow: { flexDirection: "row", gap: spacing.sm },
  tile: {
    flex: 1,
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    backgroundColor: colors.fill,
  },
  tileLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  tileValue: { fontFamily: fonts.heavy, fontSize: 18, letterSpacing: -0.3, color: colors.text, fontVariant: ["tabular-nums"] },
  place: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  placeText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  places: { gap: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.fill },
  fact: { fontFamily: fonts.regular, fontSize: 14, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  map: { height: 320, borderRadius: radius.xl, overflow: "hidden" },
  zonesRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  zonesToggle: { minHeight: 36, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.fill },
  zonesToggleText: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
  section: { fontSize: 18, fontFamily: fonts.heavy, letterSpacing: -0.3, color: colors.text, marginTop: spacing.md },
  loader: { marginVertical: spacing.xl },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  empty: { fontFamily: fonts.regular, fontSize: 15, color: colors.muted, textAlign: "center", marginVertical: spacing.lg },
});
