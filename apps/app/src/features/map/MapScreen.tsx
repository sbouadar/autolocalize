import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/States";
import { userMessage } from "@/lib/api";
import { useBranding } from "@/lib/branding-context";
import { positionedVehicles } from "@/lib/map";
import { colors, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { applyFilters, DEFAULT_FILTERS, isFiltered, type VehicleFilters } from "@/lib/vehicle-filters";
import { useVehicles } from "@/lib/vehicles";
import { VehicleFiltersBar } from "./VehicleFiltersBar";
import { VehicleList } from "./VehicleList";
import { VehicleMap } from "./VehicleMap";
import { VehicleSummary } from "./VehicleSummary";

/** Largeur à partir de laquelle liste et carte s'affichent côte à côte (tablette, ordinateur). */
export const WIDE_BREAKPOINT = 900;

type Pane = "map" | "list";

/** Carte en direct de la flotte et liste associée (côte à côte sur grand écran, en onglets sur mobile). */
export function MapScreen() {
  const branding = useBranding();
  useDocumentTitle(`Carte — ${branding.name}`);
  const router = useRouter();
  const { data, isPending, error, refetch } = useVehicles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("map");
  const [filters, setFilters] = useState<VehicleFilters>(DEFAULT_FILTERS);
  const wide = useWindowDimensions().width >= WIDE_BREAKPOINT;

  const vehicles = useMemo(() => data?.vehicles ?? [], [data]);
  // Les filtres s'appliquent à la liste et aux marqueurs de la carte.
  const shown = useMemo(() => applyFilters(vehicles, filters), [vehicles, filters]);
  const positioned = useMemo(() => positionedVehicles(shown), [shown]);
  const selected = vehicles.find((v) => v.id === selectedId) ?? null;

  if (isPending) return <LoadingState label="Chargement des véhicules…" />;
  if (!data) return <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />;
  if (vehicles.length === 0) {
    return (
      <EmptyState
        title="Aucun véhicule"
        message="Aucun véhicule n’est encore rattaché à votre compte. Contactez votre administrateur."
      />
    );
  }

  const banners: string[] = [];
  // Données déjà affichées mais dernier rafraîchissement en échec (réseau, serveur).
  if (error) banners.push("Connexion perdue : les positions ne sont plus actualisées.");
  if (!data.liveDataAvailable) {
    banners.push("Suivi en direct momentanément indisponible : positions et statuts ne peuvent pas être affichés.");
  }

  const selectFromList = (id: string) => {
    setSelectedId(id);
    if (!wide) setPane("map");
  };

  const mapPane = (
    <View style={styles.mapPane}>
      <VehicleMap vehicles={positioned} selectedId={selectedId} onSelect={setSelectedId} />
      {positioned.length === 0 ? (
        <View style={styles.mapNotice} pointerEvents="none">
          <Text style={styles.mapNoticeText}>
            {isFiltered(filters) ? "Aucun véhicule ne correspond aux filtres." : "Aucune position disponible pour le moment."}
          </Text>
        </View>
      ) : null}
      {selected ? (
        <VehicleSummary
          vehicle={selected}
          onClose={() => setSelectedId(null)}
          onOpen={() => router.push({ pathname: "/vehicles/[id]", params: { id: selected.id } })}
        />
      ) : null}
    </View>
  );
  const listPane = (
    <View style={styles.flex}>
      <VehicleFiltersBar filters={filters} onChange={setFilters} shown={shown.length} total={vehicles.length} />
      {shown.length === 0 ? (
        <View style={styles.noMatch}>
          <Text style={styles.mapNoticeText}>Aucun véhicule ne correspond à votre recherche.</Text>
          <Button label="Effacer les filtres" variant="secondary" onPress={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })} />
        </View>
      ) : (
        <VehicleList vehicles={shown} selectedId={selectedId} onSelect={selectFromList} />
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {banners.length > 0 ? (
        <View style={styles.banners}>
          {banners.map((message) => (
            <Banner key={message} message={message} />
          ))}
        </View>
      ) : null}
      {wide ? (
        <View style={styles.split}>
          <View style={styles.sidebar}>{listPane}</View>
          {mapPane}
        </View>
      ) : (
        <>
          <View style={styles.toggle}>
            <SegmentedControl
              kind="tab"
              value={pane}
              onChange={setPane}
              options={[
                { key: "map", label: "Carte" },
                { key: "list", label: `Liste (${shown.length})` },
              ]}
            />
          </View>
          {pane === "map" ? mapPane : listPane}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  noMatch: { alignItems: "center", gap: spacing.md, padding: spacing.xl },
  banners: { padding: spacing.md, paddingBottom: 0, gap: spacing.sm },
  split: { flex: 1, flexDirection: "row" },
  sidebar: { width: 360, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: colors.background },
  mapPane: { flex: 1, overflow: "hidden" },
  mapNotice: {
    position: "absolute",
    top: spacing.md,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    zIndex: 1100,
  },
  mapNoticeText: { fontSize: 14, color: colors.muted },
  toggle: { margin: spacing.md },
});
