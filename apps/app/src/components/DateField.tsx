import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useBranding } from "@/lib/branding-context";
import { formatDateOnly, isoDay, MONTH_NAMES, monthGrid, todayIso } from "@/lib/dates";
import { colors, fonts, radius, shadows, spacing } from "@/lib/theme";

interface DateFieldProps {
  label: string;
  /** Jour choisi (AAAA-MM-JJ) ou null. */
  value: string | null;
  onChange: (day: string) => void;
  /** Premier jour sélectionnable (AAAA-MM-JJ) ; sans lui, le passé reste ouvert. */
  min?: string | null;
  /** Mois affiché à l'ouverture quand aucun jour n'est choisi (AAAA-MM-JJ) ; par défaut, le mois en cours. */
  openOn?: string | null;
}

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

/** Sélecteur de date : un champ qui ouvre un calendrier mensuel. */
export function DateField({ label, value, onChange, min, openOn }: DateFieldProps) {
  const branding = useBranding();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState({ year: 2000, month: 0 });
  const today = todayIso();

  const show = () => {
    const base = value ?? openOn ?? today;
    setMonth({ year: Number(base.slice(0, 4)), month: Number(base.slice(5, 7)) - 1 });
    setOpen(true);
  };
  const move = (delta: number) =>
    setMonth(({ year, month: m }) => {
      const d = new Date(year, m + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value ? formatDateOnly(value) : "Aucune date" }}
        onPress={show}
        style={({ pressed }) => [styles.field, pressed && { opacity: 0.7 }]}
      >
        <Text style={[styles.value, !value && { color: colors.muted }]}>{value ? formatDateOnly(value) : "JJ/MM/AAAA"}</Text>
        <MaterialCommunityIcons name="calendar-blank-outline" size={20} color={colors.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Fermer le calendrier">
          {/* Un appui dans la fenêtre ne doit pas la fermer. */}
          <Pressable style={styles.sheet} onPress={() => undefined} accessible={false}>
            <View style={styles.header}>
              <Pressable accessibilityRole="button" accessibilityLabel="Mois précédent" onPress={() => move(-1)} style={styles.nav}>
                <MaterialCommunityIcons name="chevron-left" size={24} color={colors.text} />
              </Pressable>
              <Text style={styles.title}>
                {MONTH_NAMES[month.month]} {month.year}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Mois suivant" onPress={() => move(1)} style={styles.nav}>
                <MaterialCommunityIcons name="chevron-right" size={24} color={colors.text} />
              </Pressable>
            </View>
            <View style={styles.week}>
              {WEEKDAYS.map((d, i) => (
                <Text key={i} style={styles.weekday}>
                  {d}
                </Text>
              ))}
            </View>
            {monthGrid(month.year, month.month).map((week, w) => (
              <View key={w} style={styles.week}>
                {week.map((day, i) => {
                  if (day === null) return <View key={i} style={styles.day} />;
                  const iso = isoDay(month.year, month.month, day);
                  const active = iso === value;
                  const disabled = min != null && iso < min;
                  return (
                    <Pressable
                      key={i}
                      accessibilityRole="button"
                      accessibilityLabel={`${day} ${MONTH_NAMES[month.month]} ${month.year}`}
                      accessibilityState={{ selected: active, disabled }}
                      disabled={disabled}
                      onPress={() => {
                        onChange(iso);
                        setOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.day,
                        iso === today && styles.today,
                        active && { backgroundColor: branding.primaryColor, borderColor: branding.primaryColor },
                        disabled && { opacity: 0.3 },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text style={[styles.dayText, active && { color: branding.onPrimary }]}>{day}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Afficher le mois en cours"
              onPress={() => setMonth({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })}
              style={styles.todayLink}
            >
              <Text style={styles.todayLinkText}>Aujourd’hui</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
  field: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderCurve: "continuous",
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  value: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text },
  backdrop: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.lg, backgroundColor: "rgba(20, 20, 20, 0.45)" },
  sheet: {
    width: "100%",
    maxWidth: 360,
    padding: spacing.lg,
    gap: spacing.xs,
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: colors.background,
    boxShadow: shadows.overlay,
  },
  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  nav: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: colors.fill },
  title: { flex: 1, textAlign: "center", fontFamily: fonts.heavy, fontSize: 16, color: colors.text, textTransform: "capitalize" },
  week: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", paddingVertical: spacing.xs, fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  day: { flex: 1, height: 42, margin: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.full, borderWidth: 1.5, borderColor: "transparent" },
  today: { borderColor: colors.border },
  dayText: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  todayLink: { alignSelf: "center", minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md },
  todayLinkText: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
});
