import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useBranding } from "@/lib/branding-context";
import { relativeTime } from "@/lib/format";
import { colors, radius, spacing } from "@/lib/theme";
import type { Vehicle } from "@/lib/types";
import { lastSeen, movementLabel, vehicleLabel, vehicleStatus } from "@/lib/vehicles";

interface VehicleListProps {
  vehicles: Vehicle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function VehicleRow({ vehicle, selected, onPress }: { vehicle: Vehicle; selected: boolean; onPress: () => void }) {
  const branding = useBranding();
  const status = vehicleStatus(vehicle);
  const label = vehicleLabel(vehicle);
  const plate = vehicle.plate?.trim();
  const movement = movementLabel(vehicle.position);
  const seen = relativeTime(lastSeen(vehicle));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${status.label}, ${movement}, mis à jour ${seen}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && { backgroundColor: branding.primarySoft, borderColor: branding.primaryColor },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: status.color }]} />
      <View style={styles.main}>
        <Text style={styles.name} numberOfLines={1}>
          {label}
        </Text>
        {plate && plate !== label ? (
          <Text style={styles.muted} numberOfLines={1}>
            {plate}
          </Text>
        ) : null}
        <Text style={styles.muted} numberOfLines={1}>
          {status.label} · {movement}
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
  content: { padding: spacing.md, gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  main: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  time: { fontSize: 12, color: colors.muted, maxWidth: 110, textAlign: "right" },
});
