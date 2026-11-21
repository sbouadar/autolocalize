import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useBranding } from "@/lib/branding-context";
import { colors, fonts, radius, shadows, spacing } from "@/lib/theme";
import type { Vehicle } from "@/lib/types";
import { matchesQuery, matchesStatus, STATUS_FILTERS, type VehicleFilters } from "@/lib/vehicle-filters";

interface MapSearchOverlayProps {
  vehicles: Vehicle[];
  filters: VehicleFilters;
  onChange: (filters: VehicleFilters) => void;
}

/** Recherche et filtre d'état flottants au-dessus de la carte (mobile). */
export function MapSearchOverlay({ vehicles, filters, onChange }: MapSearchOverlayProps) {
  const branding = useBranding();
  const set = (patch: Partial<VehicleFilters>) => onChange({ ...filters, ...patch });
  // Les compteurs tiennent compte de la recherche en cours, pas du filtre d'état.
  const matching = vehicles.filter((v) => matchesQuery(v, filters.query));

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.search}>
        <MaterialCommunityIcons name="magnify" size={22} color={colors.muted} />
        <TextInput
          value={filters.query}
          onChangeText={(query) => set({ query })}
          placeholder="Nom ou plaque"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Rechercher sur la carte"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={styles.input}
        />
        {filters.query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Effacer la recherche"
            onPress={() => set({ query: "" })}
            hitSlop={8}
            style={styles.clear}
          >
            <MaterialCommunityIcons name="close" size={20} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        accessibilityRole="radiogroup"
        accessibilityLabel="Filtrer par état"
      >
        {STATUS_FILTERS.map((f) => {
          const active = f.key === filters.status;
          const n = matching.filter((v) => matchesStatus(v, f.key)).length;
          return (
            <Pressable
              key={f.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${f.label} : ${n}`}
              onPress={() => set({ status: f.key })}
              style={({ pressed }) => [
                styles.chip,
                active && { backgroundColor: branding.primaryColor },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={[styles.chipText, active && { color: branding.onPrimary }]}>
                {f.label} · {n}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Au-dessus des volets de Leaflet (z-index jusqu'à 1000) sur le web.
  container: { position: "absolute", top: spacing.md, left: spacing.md, right: spacing.md, gap: spacing.sm, zIndex: 1100 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 50,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    backgroundColor: colors.surface,
    boxShadow: shadows.overlay,
  },
  input: { flex: 1, minWidth: 0, fontFamily: fonts.medium, fontSize: 15, color: colors.text, paddingVertical: spacing.sm },
  clear: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  chips: { gap: spacing.sm, paddingBottom: spacing.xs },
  chip: {
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    boxShadow: shadows.raised,
  },
  chipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
});
