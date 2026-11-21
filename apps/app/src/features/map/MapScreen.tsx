import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Button } from "@/components/Button";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/States";
import { userMessage } from "@/lib/api";
import { useBranding } from "@/lib/branding-context";
import { positionedVehicles } from "@/lib/map";
import { colors, fonts, radius, shadows, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { applyFilters, DEFAULT_FILTERS, isFiltered, type VehicleFilters } from "@/lib/vehicle-filters";
import { useVehicles } from "@/lib/vehicles";
import { useSelectedZoneIds } from "@/lib/zone-selection";
import { useZones } from "@/lib/zones";
import { FleetSummary } from "./FleetSummary";
import { MapSearchOverlay } from "./MapSearchOverlay";
import { VehicleFiltersBar } from "./VehicleFiltersBar";
import { VehicleList } from "./VehicleList";
import { VehicleMap } from "./VehicleMap";
import { VehicleSummary } from "./VehicleSummary";

/** Largeur à partir de laquelle liste et carte s'affichent côte à côte (tablette, ordinateur). */
export const WIDE_BREAKPOINT = 900;

type Pane = "map" | "list";

/**
 * Carte en direct de la flotte. Sur mobile : carte avec recherche flottante et détail du véhicule
 * sélectionné en dessous, liste dans une vue à part. Sur grand écran : liste à gauche.
 */
export function MapScreen() {
  const branding = useBranding();
  useDocumentTitle(`Carte — ${branding.name}`);
  const router = useRouter();
  const { data, isPending, error, refetch } = useVehicles();
  // Zones du client, dessinées sur la carte ; leur absence (erreur, chargement) ne bloque rien.
  const zones = useZones().data?.zones;
  // Seules les zones cochées dans l'écran des zones sont dessinées.
  const selectedZoneIds = useSelectedZoneIds();
  const shownZones = useMemo(() => zones?.filter((z) => selectedZoneIds.has(z.id)), [zones, selectedZoneIds]);
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
  const showList = wide ? undefined : () => setPane("list");
  const zonesLabel = zones?.length ? `Zones (${zones.length})` : "Zones";

  const mapPane = (
    <View style={styles.flex}>
      <View style={styles.mapArea}>
        <VehicleMap vehicles={positioned} selectedId={selectedId} onSelect={setSelectedId} zones={shownZones} />
        {wide ? null : <MapSearchOverlay vehicles={vehicles} filters={filters} onChange={setFilters} />}
        {positioned.length === 0 ? (
          <View style={[styles.mapNotice, !wide && styles.mapNoticeBelowSearch]} pointerEvents="none">
            <Text style={styles.mapNoticeText}>
              {isFiltered(filters) ? "Aucun véhicule ne correspond aux filtres." : "Aucune position disponible pour le moment."}
            </Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={zonesLabel}
          onPress={() => router.push("/zones")}
          style={({ pressed }) => [styles.zones, wide ? styles.zonesTop : styles.zonesBottom, pressed && { opacity: 0.8 }]}
        >
          <MaterialCommunityIcons name="map-marker-radius-outline" size={20} color={colors.text} />
          <Text style={styles.zonesText}>{zonesLabel}</Text>
        </Pressable>
      </View>
      <View style={styles.panel}>
        {selected ? (
          <VehicleSummary
            vehicle={selected}
            onClose={() => setSelectedId(null)}
            onOpen={() => router.push({ pathname: "/vehicles/[id]", params: { id: selected.id } })}
            onShowList={showList}
          />
        ) : (
          <FleetSummary vehicles={vehicles} onShowList={showList} />
        )}
      </View>
    </View>
  );

  const listPane = (
    <View style={styles.flex}>
      {wide ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retour à la carte"
          onPress={() => setPane("map")}
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
          <Text style={styles.backText}>Carte</Text>
        </Pressable>
      )}
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
      ) : pane === "map" ? (
        mapPane
      ) : (
        listPane
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
  sidebar: {
    width: 380,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    backgroundColor: colors.background,
  },
  mapArea: { flex: 1, overflow: "hidden" },
  // Au-dessus des volets de Leaflet (z-index jusqu'à 1000) sur le web.
  mapNotice: {
    position: "absolute",
    top: spacing.md,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    boxShadow: shadows.raised,
    zIndex: 1100,
  },
  mapNoticeBelowSearch: { top: 120 },
  mapNoticeText: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted, textAlign: "center" },
  zones: {
    position: "absolute",
    right: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    boxShadow: shadows.raised,
    zIndex: 1100,
  },
  zonesTop: { top: spacing.md },
  // Au-dessus de l'attribution des tuiles, qui doit rester visible.
  zonesBottom: { bottom: spacing.xl },
  zonesText: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  panel: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    boxShadow: "0 -4px 16px rgba(20, 20, 20, 0.08)",
    zIndex: 1100,
  },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    alignSelf: "flex-start",
  },
  backText: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
});
