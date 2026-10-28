import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useBranding } from "@/lib/branding-context";
import { colors, radius, spacing } from "@/lib/theme";
import { SORT_KEYS, STATUS_FILTERS, type VehicleFilters } from "@/lib/vehicle-filters";

interface VehicleFiltersBarProps {
  filters: VehicleFilters;
  onChange: (filters: VehicleFilters) => void;
  shown: number;
  total: number;
}

/** Recherche, filtre de statut et tri de la liste (appliqués aussi aux marqueurs de la carte). */
export function VehicleFiltersBar({ filters, onChange, shown, total }: VehicleFiltersBarProps) {
  const branding = useBranding();
  const [focused, setFocused] = useState(false);
  const set = (patch: Partial<VehicleFilters>) => onChange({ ...filters, ...patch });

  return (
    <View style={styles.container}>
      <View style={[styles.search, focused && { borderColor: branding.primaryColor }]}>
        <TextInput
          value={filters.query}
          onChangeText={(query) => set({ query })}
          placeholder="Rechercher un nom ou une plaque"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Rechercher un véhicule"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.input}
        />
        {filters.query ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => set({ query: "" })} hitSlop={8}>
            <Text style={styles.clear}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <SegmentedControl options={STATUS_FILTERS} value={filters.status} onChange={(status) => set({ status })} />
      <View style={styles.sortRow}>
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {shown === total ? `${total} véhicule${total > 1 ? "s" : ""}` : `${shown} sur ${total}`}
        </Text>
        <View style={styles.sorts} accessibilityRole="radiogroup" accessibilityLabel="Trier par">
          <Text style={styles.count}>Trier :</Text>
          {SORT_KEYS.map((s) => {
            const active = s.key === filters.sort;
            return (
              <Pressable
                key={s.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                accessibilityLabel={`Trier par ${s.label.toLowerCase()}`}
                onPress={() => set({ sort: s.key })}
                hitSlop={6}
              >
                <Text style={[styles.sort, active && { color: branding.primaryColor, fontWeight: "700" }]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, padding: spacing.md, paddingBottom: 0 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: spacing.sm },
  clear: { fontSize: 22, lineHeight: 22, color: colors.muted },
  sortRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  sorts: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  count: { fontSize: 13, color: colors.muted },
  sort: { fontSize: 13, color: colors.text },
});
