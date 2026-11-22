import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { CAR_DIAGRAM_URI, DAMAGE_COLORS, DIAGRAM_RATIO, type Damage } from "@/lib/car-diagram";
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

/** Schéma du véhicule vu de dessus, avec ses impacts numérotés. */
export function CarDamageDiagram({ damages, width = 180, onPressAt, highlighted }: CarDamageDiagramProps) {
  const height = width * DIAGRAM_RATIO;
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
        onPress={(e: GestureResponderEvent) => onPressAt(e.nativeEvent.locationX, e.nativeEvent.locationY)}
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
});
