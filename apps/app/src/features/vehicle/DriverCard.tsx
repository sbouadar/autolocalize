import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { SelectField } from "@/components/SelectField";
import { Banner } from "@/components/States";
import { formMessage } from "@/lib/api";
import { useAssignDriver, useDrivers, useVehicleDriver, type Assignment } from "@/lib/drivers";
import { formatDateTime } from "@/lib/format";
import { colors, fonts, spacing } from "@/lib/theme";

const NONE = "__none__";
const HISTORY_SHOWN = 4;

function span(a: Assignment): string {
  return a.endAt ? `du ${formatDateTime(a.startAt)} au ${formatDateTime(a.endAt)}` : `depuis le ${formatDateTime(a.startAt)}`;
}

/** Choix du conducteur du véhicule (admin) : effet immédiat, l'affectation précédente se termine. */
function AssignForm({ vehicleId, currentDriverId, onDone }: { vehicleId: string; currentDriverId: string | null; onDone: () => void }) {
  const drivers = useDrivers().data?.drivers ?? [];
  const assign = useAssignDriver(vehicleId);
  const [choice, setChoice] = useState<string | null>(currentDriverId ?? NONE);
  const [error, setError] = useState<string | null>(null);
  const options = [
    { key: NONE, label: "Aucun conducteur" },
    ...drivers.map((d) => ({ key: d.id, label: d.currentVehicle && d.currentVehicle.id !== vehicleId ? `${d.name} (conduit ${d.currentVehicle.name})` : d.name })),
  ];

  const save = async () => {
    setError(null);
    try {
      await assign.mutateAsync({ driverId: choice === NONE ? null : choice });
      onDone();
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <View style={styles.form}>
      <SelectField label="Conducteur" options={options} value={choice} onChange={setChoice} />
      <Text style={styles.muted}>Le changement prend effet maintenant. Un conducteur qui conduisait un autre véhicule le quitte.</Text>
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label="Enregistrer" onPress={() => void save()} loading={assign.isPending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={onDone} disabled={assign.isPending} />
        </View>
      </View>
    </View>
  );
}

/** Bloc « Conducteur » de la fiche (module conducteurs) : conducteur actuel et derniers changements. */
export function DriverCard({ vehicleId, canEdit }: { vehicleId: string; canEdit: boolean }) {
  const router = useRouter();
  const { data, isPending, isError } = useVehicleDriver(vehicleId);
  const [editing, setEditing] = useState(false);
  const current = data?.current ?? null;
  const past = (data?.assignments ?? []).filter((a) => a.endAt !== null).slice(0, HISTORY_SHOWN);

  return (
    <Card title="Conducteur" right={canEdit && !editing ? <Button label="Changer" variant="secondary" onPress={() => setEditing(true)} /> : null}>
      {editing ? <AssignForm vehicleId={vehicleId} currentDriverId={current?.driver.id ?? null} onDone={() => setEditing(false)} /> : null}
      {isPending ? (
        <Text style={styles.muted}>Chargement…</Text>
      ) : isError ? (
        <Text style={styles.muted}>Le conducteur n’a pas pu être chargé.</Text>
      ) : current ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${current.driver.name}, ${span(current)}. Ouvrir la fiche du conducteur`}
          onPress={() => router.push({ pathname: "/drivers/[id]", params: { id: current.driver.id } })}
          style={({ pressed }) => pressed && { opacity: 0.7 }}
        >
          <Text style={styles.name}>{current.driver.name}</Text>
          <Text style={styles.muted}>{span(current)}</Text>
        </Pressable>
      ) : (
        <Text style={styles.muted}>Aucun conducteur affecté.</Text>
      )}
      {past.length > 0 ? (
        <View style={styles.history}>
          <Text style={styles.historyTitle}>Précédents</Text>
          {past.map((a) => (
            <Text key={a.id} style={styles.muted}>
              {a.driver.name}, {span(a)}
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: spacing.md },
  pair: { flexDirection: "row", gap: spacing.sm },
  name: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  history: { gap: spacing.xs },
  historyTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
});
