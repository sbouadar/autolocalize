import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { useRentals, type Rental } from "@/lib/rentals";
import { colors, fonts, spacing } from "@/lib/theme";
import { RentalRow } from "../rentals/RentalRow";

const SHOWN = 5;

/** Ordre d'affichage : en cours, puis à venir (la plus proche d'abord), puis passées (la plus récente d'abord). */
function sortForVehicle(rentals: Rental[]): Rental[] {
  const rank = (r: Rental) => (r.status === "ONGOING" ? 0 : r.status === "RESERVED" ? 1 : 2);
  return [...rentals].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return rank(a) === 2 ? b.startAt.localeCompare(a.startAt) : a.startAt.localeCompare(b.startAt);
  });
}

/**
 * Locations du véhicule (module location activé) : en cours, à venir et terminées depuis 30 jours.
 * Les admins et les agents peuvent en créer une, le véhicule étant alors proposé d'office.
 */
export function RentalsCard({ vehicleId, canBook }: { vehicleId: string; canBook: boolean }) {
  const router = useRouter();
  const { data, isPending, isError } = useRentals({ vehicleId });
  const rentals = sortForVehicle((data?.rentals ?? []).filter((r) => r.status !== "CANCELLED"));

  return (
    <Card
      title="Locations"
      right={
        canBook ? (
          <Button
            label="Réserver"
            variant="secondary"
            onPress={() => router.push({ pathname: "/rentals/new", params: { vehicleId } })}
          />
        ) : null
      }
    >
      {isPending ? (
        <Text style={styles.muted}>Chargement des locations…</Text>
      ) : isError ? (
        <Text style={styles.muted}>Les locations n’ont pas pu être chargées.</Text>
      ) : rentals.length === 0 ? (
        <Text style={styles.muted}>Aucune location en cours, à venir ou récente.</Text>
      ) : (
        <View style={styles.list}>
          {rentals.slice(0, SHOWN).map((r) => (
            <RentalRow
              key={r.id}
              rental={r}
              showVehicle={false}
              tone="surface"
              onPress={() => router.push({ pathname: "/rentals/[id]", params: { id: r.id } })}
            />
          ))}
          {rentals.length > SHOWN ? <Text style={styles.muted}>Et {rentals.length - SHOWN} autres dans l’onglet « Locations ».</Text> : null}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
