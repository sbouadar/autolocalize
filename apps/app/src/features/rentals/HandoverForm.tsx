import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { ChoiceChips } from "@/components/ChoiceChips";
import { DateField } from "@/components/DateField";
import { SelectField } from "@/components/SelectField";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { localDateTime, TIME_OPTIONS, todayIso } from "@/lib/dates";
import { formatKm } from "@/lib/format";
import { FUEL_LEVELS, useRentalActions, type Rental } from "@/lib/rentals";
import { colors, fonts, spacing } from "@/lib/theme";

const FUEL_OPTIONS = FUEL_LEVELS.map((label, level) => ({ key: String(level), label }));
const WHEN_OPTIONS: { key: "now" | "other"; label: string }[] = [
  { key: "now", label: "Maintenant" },
  { key: "other", label: "Autre date" },
];
/** Au-delà de ce retard sur le moment prévu, on propose d'abord de saisir la date réelle (ancienne location reprise). */
const BACKDATE_AFTER_MS = 24 * 3_600_000;

/** Jour (AAAA-MM-JJ) et heure (HH:MM) locaux d'un instant. */
function localParts(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  return { day: todayIso(d), time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` };
}

/** Départ (remise du véhicule) ou retour : compteur et niveau de carburant. */
export function HandoverForm({ rental, kind, onDone }: { rental: Rental; kind: "pickup" | "return"; onDone: () => void }) {
  const { pickup, giveBack } = useRentalActions();
  const mutation = kind === "pickup" ? pickup : giveBack;
  const [km, setKm] = useState("");
  const [fuel, setFuel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Date réelle : maintenant, ou une date passée préremplie avec le moment prévu.
  const planned = kind === "pickup" ? rental.startAt : rental.endAt;
  const [plannedParts] = useState(() => localParts(planned));
  const [when, setWhen] = useState<"now" | "other">(() => (Date.parse(planned) < Date.now() - BACKDATE_AFTER_MS ? "other" : "now"));
  const [day, setDay] = useState<string | null>(plannedParts.day);
  const [time, setTime] = useState(plannedParts.time);
  // Une heure prévue hors des demi-heures (saisie ancienne) reste proposée.
  const timeOptions = TIME_OPTIONS.some((o) => o.key === plannedParts.time)
    ? TIME_OPTIONS
    : [...TIME_OPTIONS, { key: plannedParts.time, label: plannedParts.time }].sort((a, b) => a.key.localeCompare(b.key));
  const whenLabel = kind === "pickup" ? "départ" : "retour";

  const submit = async () => {
    setError(null);
    const digits = km.replace(/[\s\u202f]/g, "");
    if (!/^\d+$/.test(digits)) return setError("Saisissez le kilométrage affiché au compteur, en chiffres.");
    if (fuel === null) return setError("Indiquez le niveau de carburant.");
    const odometerKm = Number(digits);
    if (kind === "return" && rental.odometerOutKm != null && odometerKm < rental.odometerOutKm) {
      return setError(`Le compteur indiquait ${formatKm(rental.odometerOutKm)} au départ.`);
    }
    let at: string | undefined;
    if (when === "other") {
      if (!day) return setError(`Choisissez la date du ${whenLabel}.`);
      at = localDateTime(day, time);
      if (Date.parse(at) > Date.now()) return setError(`La date du ${whenLabel} ne peut pas être dans le futur.`);
      if (kind === "return" && rental.pickedUpAt && Date.parse(at) <= Date.parse(rental.pickedUpAt)) return setError("Le retour doit être après le départ.");
    }
    try {
      await mutation.mutateAsync({ id: rental.id, body: { odometerKm, fuelLevel: Number(fuel), ...(at && { at }) } });
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
      <Text style={styles.label}>{kind === "pickup" ? "Date du départ" : "Date du retour"}</Text>
      <ChoiceChips options={WHEN_OPTIONS} value={when} onChange={setWhen} label={`Date du ${whenLabel}`} />
      {when === "other" ? (
        <View style={styles.pair}>
          <View style={styles.flex}>
            <DateField label={`Jour du ${whenLabel}`} value={day} onChange={setDay} />
          </View>
          <View style={styles.time}>
            <SelectField label={`Heure du ${whenLabel}`} options={timeOptions} value={time} onChange={setTime} />
          </View>
        </View>
      ) : null}
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
  time: { width: 130 },
  label: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
