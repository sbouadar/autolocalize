import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/Card";
import { CarDamageDiagram } from "@/components/CarDamageDiagram";
import { DAMAGE_LABELS, newDamages, type Damage } from "@/lib/car-diagram";
import { FUEL_LEVELS, type Rental } from "@/lib/rentals";
import { colors, fonts, spacing } from "@/lib/theme";

function Side({ title, damages, fuel, fresh }: { title: string; damages: Damage[]; fuel: number | null; fresh?: Set<number> }) {
  return (
    <View style={styles.side}>
      <Text style={styles.title}>{title}</Text>
      <CarDamageDiagram damages={damages} width={120} highlighted={fresh} />
      <Text style={styles.text}>Carburant : {fuel == null ? "—" : FUEL_LEVELS[fuel]}</Text>
      {damages.length === 0 ? <Text style={styles.muted}>Aucun impact relevé.</Text> : null}
      {damages.map((d, i) => (
        <Text key={i} style={[styles.muted, fresh?.has(i) && styles.fresh]}>
          {i + 1}. {DAMAGE_LABELS[d.type]}
          {d.note ? ` : ${d.note}` : ""}
          {fresh?.has(i) ? " (nouveau)" : ""}
        </Text>
      ))}
    </View>
  );
}

/** État des lieux de la location : schéma au départ et, après le retour, au retour. */
export function DamageReport({ rental }: { rental: Rental }) {
  if (!rental.pickedUpAt) return null;
  const returned = rental.status === "COMPLETED";
  const fresh = returned ? newDamages(rental.damagesOut, rental.damagesIn) : undefined;
  return (
    <Card title="État des lieux">
      <View style={styles.row}>
        <Side title="Au départ" damages={rental.damagesOut} fuel={rental.fuelOut} />
        {returned ? <Side title="Au retour" damages={rental.damagesIn} fuel={rental.fuelIn} fresh={fresh} /> : null}
      </View>
      {fresh && fresh.size > 0 ? (
        <Text style={styles.fresh}>
          {fresh.size} impact{fresh.size > 1 ? "s" : ""} relevé{fresh.size > 1 ? "s" : ""} au retour et absent{fresh.size > 1 ? "s" : ""} au départ.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xl },
  side: { gap: spacing.xs, minWidth: 140, flexShrink: 1 },
  title: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  text: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  fresh: { fontFamily: fonts.bold, fontSize: 13, color: colors.danger },
});
