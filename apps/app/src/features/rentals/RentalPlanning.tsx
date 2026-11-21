import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Rental } from "@/lib/rentals";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { rentalTone } from "./RentalRow";

export const PLANNING_DAYS = 14;
const DAY_MS = 86_400_000;
const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });

interface RentalPlanningProps {
  vehicles: { id: string; name: string }[];
  rentals: Rental[];
  /** Début du planning (minuit local du premier jour). */
  start: Date;
  onOpen: (rentalId: string) => void;
}

/** Planning sur deux semaines (grand écran) : une ligne par véhicule, une barre par location. */
export function RentalPlanning({ vehicles, rentals, start, onOpen }: RentalPlanningProps) {
  const from = start.getTime();
  const to = from + PLANNING_DAYS * DAY_MS;
  const days = Array.from({ length: PLANNING_DAYS }, (_, i) => new Date(from + i * DAY_MS));
  const shown = rentals.filter((r) => r.status !== "CANCELLED" && Date.parse(r.startAt) < to && Date.parse(r.endAt) > from);

  return (
    <View style={styles.planning} accessibilityLabel="Planning des locations sur deux semaines">
      <View style={styles.line}>
        <View style={styles.vehicle} />
        <View style={styles.track}>
          {days.map((d) => (
            <View key={d.getTime()} style={styles.day}>
              <Text style={styles.dayText}>{weekday.format(d).replace(".", "")}</Text>
              <Text style={styles.dayNumber}>{d.getDate()}</Text>
            </View>
          ))}
        </View>
      </View>
      {vehicles.map((v) => (
        <View key={v.id} style={styles.line}>
          <Text style={[styles.vehicle, styles.vehicleText]} numberOfLines={1}>
            {v.name}
          </Text>
          <View style={[styles.track, styles.trackRow]}>
            {days.map((d, i) => (i > 0 ? <View key={d.getTime()} style={[styles.grid, { left: `${(i / PLANNING_DAYS) * 100}%` }]} /> : null))}
            {shown
              .filter((r) => r.vehicleId === v.id)
              .map((r) => {
                const left = Math.max(0, (Date.parse(r.startAt) - from) / (to - from));
                const right = Math.min(1, (Date.parse(r.endAt) - from) / (to - from));
                const tone = rentalTone(r);
                return (
                  <Pressable
                    key={r.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${v.name}, ${r.customerName}, ${tone.label}. Ouvrir la location`}
                    onPress={() => onOpen(r.id)}
                    style={({ pressed }) => [
                      styles.bar,
                      { left: `${left * 100}%`, width: `${Math.max(right - left, 0.015) * 100}%`, backgroundColor: tone.color },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={styles.barText} numberOfLines={1}>
                      {r.customerName}
                    </Text>
                  </Pressable>
                );
              })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  planning: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.fill },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  vehicle: { width: 130 },
  vehicleText: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
  track: { flex: 1, flexDirection: "row" },
  trackRow: { height: 34, borderRadius: radius.sm, backgroundColor: colors.surface, overflow: "hidden" },
  day: { flex: 1, alignItems: "center" },
  dayText: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted },
  dayNumber: { fontFamily: fonts.bold, fontSize: 12, color: colors.text },
  grid: { position: "absolute", top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  bar: { position: "absolute", top: 4, bottom: 4, borderRadius: radius.sm, justifyContent: "center", paddingHorizontal: 6 },
  barText: { fontFamily: fonts.bold, fontSize: 11, color: colors.onDark },
});
