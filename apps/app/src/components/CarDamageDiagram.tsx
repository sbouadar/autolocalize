import { Image } from "expo-image";
import { useRef, type ComponentRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { CAR_DIAGRAM_URI, DAMAGE_COLORS, DAMAGE_LABELS, DIAGRAM_RATIO, damageTypeSchema, type Damage } from "@/lib/car-diagram";
import { colors, fonts } from "@/lib/theme";

interface CarDamageDiagramProps {
  damages: Damage[];
  width?: number;
  /** Appui sur le schéma : position en points (absent : schéma en lecture seule). */
  onPressAt?: (locationX: number, locationY: number) => void;
  /** Impacts à cercler (nouveaux au retour). */
  highlighted?: Set<number>;
}

const MARK = 22;

type PressNativeEvent = { locationX?: number; locationY?: number; clientX?: number; clientY?: number };

/**
 * Position de l'appui dans le schéma. Mobile : locationX/locationY. Web : le navigateur ne les
 * fournit pas, on part de la position du clic dans la fenêtre et du cadre du schéma.
 */
export function pressPosition(nativeEvent: PressNativeEvent, rect: { left: number; top: number } | null): { x: number; y: number } | null {
  let x = nativeEvent.locationX;
  let y = nativeEvent.locationY;
  if ((!Number.isFinite(x) || !Number.isFinite(y)) && rect && Number.isFinite(nativeEvent.clientX) && Number.isFinite(nativeEvent.clientY)) {
    x = nativeEvent.clientX! - rect.left;
    y = nativeEvent.clientY! - rect.top;
  }
  return Number.isFinite(x) && Number.isFinite(y) ? { x: x!, y: y! } : null;
}

/** Couleur de chaque type d'impact. */
export function DamageLegend() {
  return (
    <View style={styles.legend}>
      {damageTypeSchema.options.map((t) => (
        <View key={t} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: DAMAGE_COLORS[t] }]} />
          <Text style={styles.legendText}>{DAMAGE_LABELS[t]}</Text>
        </View>
      ))}
    </View>
  );
}

/** Schéma du véhicule vu de dessus, avec ses impacts numérotés. */
export function CarDamageDiagram({ damages, width = 180, onPressAt, highlighted }: CarDamageDiagramProps) {
  const height = width * DIAGRAM_RATIO;
  const area = useRef<ComponentRef<typeof Pressable>>(null);
  const marks = damages.map((d, i) => (
    <View
      key={`${i}-${d.x}-${d.y}`}
      pointerEvents="none"
      style={[
        styles.mark,
        { left: d.x * width - MARK / 2, top: d.y * height - MARK / 2, backgroundColor: DAMAGE_COLORS[d.type] },
        highlighted?.has(i) && { borderWidth: 3, borderColor: colors.text },
      ]}
    >
      <Text style={styles.markText}>{i + 1}</Text>
    </View>
  ));
  const content = (
    <>
      <Text style={styles.side}>AVANT</Text>
      <View style={{ width, height }}>
        <Image source={{ uri: CAR_DIAGRAM_URI }} style={{ width, height }} contentFit="contain" pointerEvents="none" accessible={false} />
        {marks}
      </View>
      <Text style={styles.side}>ARRIÈRE</Text>
    </>
  );
  if (!onPressAt) {
    return (
      <View style={styles.wrap} accessible accessibilityLabel={`Schéma du véhicule : ${damages.length} impact${damages.length > 1 ? "s" : ""}`}>
        {content}
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <Text style={styles.side}>AVANT</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Schéma du véhicule : touchez l’endroit d’un impact"
        ref={area}
        onPress={(e: GestureResponderEvent) => {
          // Web : la vue est un élément du DOM, dont on lit le cadre à l'écran.
          const node = Platform.OS === "web" ? (area.current as unknown as { getBoundingClientRect?: () => { left: number; top: number } } | null) : null;
          const rect = node?.getBoundingClientRect ? node.getBoundingClientRect() : null;
          const at = pressPosition(e.nativeEvent as unknown as PressNativeEvent, rect);
          // Position inconnue : on n'ajoute pas un impact qui serait mal placé.
          if (at) onPressAt(at.x, at.y);
        }}
        style={{ width, height }}
      >
        <Image source={{ uri: CAR_DIAGRAM_URI }} style={{ width, height }} contentFit="contain" pointerEvents="none" accessible={false} />
        {marks}
      </Pressable>
      <Text style={styles.side}>ARRIÈRE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 2 },
  side: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1, color: colors.muted },
  mark: { position: "absolute", width: MARK, height: MARK, borderRadius: MARK / 2, alignItems: "center", justifyContent: "center" },
  markText: { fontFamily: fonts.heavy, fontSize: 11, color: "#FFFFFF" },
  legend: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
});
