import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useBranding } from "@/lib/branding-context";
import { formatSpeed, relativeTime } from "@/lib/format";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import type { Vehicle } from "@/lib/types";
import { lastSeen, vehicleLabel, vehicleState } from "@/lib/vehicles";

interface VehicleListProps {
  vehicles: Vehicle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function VehicleRow({ vehicle, selected, onPress }: { vehicle: Vehicle; selected: boolean; onPress: () => void }) {
  const branding = useBranding();
  const state = vehicleState(vehicle);
  const label = vehicleLabel(vehicle);
  const plate = vehicle.plate?.trim();
  const detail =
    state.key === "moving" && vehicle.position
      ? `${state.label} · ${formatSpeed(vehicle.position.speedKmh)}`
      : vehicle.position
        ? state.label
        : `${state.label} · position inconnue`;
  const seen = relativeTime(lastSeen(vehicle));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${detail}, mis à jour ${seen}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && { backgroundColor: branding.primarySoft },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.badge, { backgroundColor: state.color }]}>
        <MaterialCommunityIcons name="car" size={18} color={colors.onDark} />
      </View>
      <View style={styles.main}>
        <Text style={styles.name} numberOfLines={1}>
          {label}
        </Text>
        {plate && plate !== label ? (
          <Text style={styles.muted} numberOfLines={1}>
            {plate}
          </Text>
        ) : null}
        <Text style={[styles.detail, { color: state.color }]} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Text style={styles.time} numberOfLines={1}>
        {seen}
      </Text>
    </Pressable>
  );
}

export function VehicleList({ vehicles, selectedId, onSelect }: VehicleListProps) {
  return (
    <FlatList
      data={vehicles}
      keyExtractor={(v) => v.id}
      contentContainerStyle={styles.content}
      renderItem={({ item }) => (
        <VehicleRow vehicle={item} selected={item.id === selectedId} onPress={() => onSelect(item.id)} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderCurve: "continuous",
  },
  pressed: { opacity: 0.8 },
  badge: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  detail: { fontFamily: fonts.bold, fontSize: 13 },
  main: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  time: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, maxWidth: 110, textAlign: "right" },
});
