import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { ChoiceChips } from "@/components/ChoiceChips";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { formatKm } from "@/lib/format";
import { FUEL_LEVELS, useRentalActions, type Rental } from "@/lib/rentals";
import { colors, fonts, spacing } from "@/lib/theme";

const FUEL_OPTIONS = FUEL_LEVELS.map((label, level) => ({ key: String(level), label }));

/** Départ (remise du véhicule) ou retour : compteur et niveau de carburant. */
export function HandoverForm({ rental, kind, onDone }: { rental: Rental; kind: "pickup" | "return"; onDone: () => void }) {
  const { pickup, giveBack } = useRentalActions();
  const mutation = kind === "pickup" ? pickup : giveBack;
  const [km, setKm] = useState("");
  const [fuel, setFuel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const digits = km.replace(/[\s\u202f]/g, "");
    if (!/^\d+$/.test(digits)) return setError("Saisissez le kilométrage affiché au compteur, en chiffres.");
    if (fuel === null) return setError("Indiquez le niveau de carburant.");
    const odometerKm = Number(digits);
    if (kind === "return" && rental.odometerOutKm != null && odometerKm < rental.odometerOutKm) {
      return setError(`Le compteur indiquait ${formatKm(rental.odometerOutKm)} au départ.`);
    }
    try {
      await mutation.mutateAsync({ id: rental.id, body: { odometerKm, fuelLevel: Number(fuel) } });
      onDone();
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.muted}>
        {kind === "pickup"
          ? "À la remise des clés. Le contrat est généré à ce moment et ne pourra plus être modifié : vérifiez d’abord la fiche du locataire."
          : "À la restitution du véhicule. La distance parcourue sera comparée à celle mesurée par le GPS."}
      </Text>
      <TextField
        label={kind === "pickup" ? "Compteur au départ (km)" : "Compteur au retour (km)"}
        value={km}
        onChangeText={setKm}
        keyboardType="number-pad"
        maxLength={9}
      />
      <Text style={styles.label}>Carburant</Text>
      <ChoiceChips options={FUEL_OPTIONS} value={fuel} onChange={setFuel} label="Niveau de carburant" />
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label={kind === "pickup" ? "Valider le départ" : "Valider le retour"} onPress={() => void submit()} loading={mutation.isPending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={onDone} disabled={mutation.isPending} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: spacing.md },
  pair: { flexDirection: "row", gap: spacing.sm },
  label: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
