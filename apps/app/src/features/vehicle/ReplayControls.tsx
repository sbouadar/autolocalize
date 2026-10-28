import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useBranding } from "@/lib/branding-context";
import { formatSpeed, formatTime } from "@/lib/format";
import { frameAt, replayBounds, REPLAY_SPEEDS, type ReplayFrame, type ReplaySpeed } from "@/lib/replay";
import { colors, radius, spacing } from "@/lib/theme";
import type { RoutePoint } from "@/lib/types";

const TICK_MS = 100;

/**
 * Lecture du tracé : avance un instant t le long des positions et transmet la position
 * interpolée (onFrame) à la carte. Repart du début à chaque nouveau tracé.
 */
export function ReplayControls({
  points,
  withDay,
  onFrame,
  onClose,
}: {
  points: RoutePoint[];
  withDay: boolean;
  onFrame: (frame: ReplayFrame | null) => void;
  onClose: () => void;
}) {
  const branding = useBranding();
  const bounds = useMemo(() => replayBounds(points), [points]);
  const [t, setT] = useState(() => bounds?.start ?? 0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<ReplaySpeed>(60);
  const [width, setWidth] = useState(0);

  // Lecture : l'instant avance de TICK_MS × vitesse à chaque tick, jusqu'à la fin du tracé.
  useEffect(() => {
    if (!playing || !bounds) return;
    const timer = setInterval(() => {
      setT((current) => {
        const next = current + TICK_MS * speed;
        if (next >= bounds.end) {
          setPlaying(false);
          return bounds.end;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, speed, bounds]);

  const frame = useMemo(() => (bounds ? frameAt(points, t) : null), [points, t, bounds]);
  useEffect(() => onFrame(frame), [frame, onFrame]);
  useEffect(() => () => onFrame(null), [onFrame]);

  if (!bounds) {
    return (
      <View style={styles.panel}>
        <Text style={styles.muted}>Pas assez de positions sur cette période pour rejouer le trajet.</Text>
        <Button label="Fermer" variant="secondary" onPress={onClose} />
      </View>
    );
  }

  const progress = (t - bounds.start) / (bounds.end - bounds.start);
  const seek = (x: number) => {
    if (width <= 0) return;
    const ratio = Math.min(1, Math.max(0, x / width));
    setT(bounds.start + ratio * (bounds.end - bounds.start));
  };
  const toggle = () => {
    if (!playing && t >= bounds.end) setT(bounds.start); // relance depuis le début
    setPlaying((p) => !p);
  };

  return (
    <View style={styles.panel} accessibilityLabel="Replay du trajet">
      <View style={styles.row}>
        <Text style={styles.time} accessibilityLiveRegion="polite">
          {formatTime(new Date(frame?.time ?? t).toISOString(), withDay)} · {formatSpeed(frame?.speedKmh)}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Fermer le replay" onPress={onClose} hitSlop={8}>
          <Text style={styles.close}>×</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Position dans le replay"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => seek(e.nativeEvent.locationX)}
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: branding.primaryColor }]} />
      </Pressable>
      <View style={styles.row}>
        <Text style={styles.muted}>{formatTime(new Date(bounds.start).toISOString(), withDay)}</Text>
        <Text style={styles.muted}>{formatTime(new Date(bounds.end).toISOString(), withDay)}</Text>
      </View>
      <View style={styles.row}>
        <Button label={playing ? "Pause" : t >= bounds.end ? "Rejouer" : "Lecture"} onPress={toggle} />
        <View style={styles.speeds}>
          <SegmentedControl
            options={REPLAY_SPEEDS.map((s) => ({ key: String(s), label: `×${s}` }))}
            value={String(speed)}
            onChange={(s) => setSpeed(Number(s) as ReplaySpeed)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  time: { fontSize: 16, fontWeight: "700", color: colors.text },
  close: { fontSize: 24, lineHeight: 24, color: colors.muted },
  track: { height: 24, justifyContent: "center", borderRadius: 12, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 24 },
  speeds: { flex: 1, maxWidth: 260 },
  muted: { fontSize: 12, color: colors.muted },
});
