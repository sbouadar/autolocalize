import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBranding } from "@/lib/branding-context";
import { formatDistance, formatDuration, formatSpeed, formatTime } from "@/lib/format";
import { colors, radius, spacing } from "@/lib/theme";
import type { Trip } from "@/lib/types";

interface TripListProps {
  trips: Trip[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  /** Affiche le jour en plus de l'heure (périodes de plusieurs jours). */
  withDay: boolean;
}

/** Trajets de la période ; un appui affiche le trajet seul sur la carte, un second appui le désélectionne. */
export function TripList({ trips, selectedIndex, onSelect, withDay }: TripListProps) {
  const branding = useBranding();
  return (
    <View style={styles.list}>
      {trips.map((trip, index) => {
        const selected = index === selectedIndex;
        const when = `${formatTime(trip.startTime, withDay)} → ${formatTime(trip.endTime)}`;
        return (
          <Pressable
            key={`${trip.startTime}-${index}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Trajet ${when}, ${formatDistance(trip.distanceKm)}, ${formatDuration(trip.durationMs)}`}
            onPress={() => onSelect(selected ? null : index)}
            style={({ pressed }) => [
              styles.row,
              selected && { borderColor: branding.primaryColor, backgroundColor: branding.primarySoft },
              pressed && { opacity: 0.8 },
            ]}
          >
            <View style={styles.head}>
              <Text style={styles.when}>{when}</Text>
              <Text style={styles.distance}>{formatDistance(trip.distanceKm)}</Text>
            </View>
            <Text style={styles.muted}>
              {formatDuration(trip.durationMs)} · moyenne {formatSpeed(trip.averageSpeedKmh)} · max{" "}
              {formatSpeed(trip.maxSpeedKmh)}
            </Text>
            {trip.distanceKm == null ? (
              <Text style={styles.muted}>Distance non mesurable : position GPS aberrante pendant ce trajet.</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    padding: spacing.md,
    gap: 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  head: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  when: { fontSize: 15, fontWeight: "600", color: colors.text },
  distance: { fontSize: 15, fontWeight: "600", color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
});
