import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { formatDateTime, formatKm } from "@/lib/format";
import { colors, fonts, spacing } from "@/lib/theme";
import { ODOMETER_SOURCE_LABELS, useOdometer, useOdometerActions, type Odometer } from "@/lib/vehicle-info";

const READINGS_SHOWN = 5;

function estimateNote(data: Odometer): string | null {
  if (!data.lastReading) return null;
  switch (data.unavailableReason) {
    case "TRACCAR_UNAVAILABLE":
      return "Distance GPS momentanément indisponible : seul le dernier relevé est connu.";
    case "READING_TOO_OLD":
      return "Dernier relevé de plus d’un an : saisissez un nouveau relevé pour estimer le compteur.";
    default:
      return data.partial ? "Estimation par défaut : certains trajets aux positions GPS aberrantes n’ont pas pu être comptés." : null;
  }
}

/**
 * Bloc « Compteur » : compteur estimé (dernier relevé + distance GPS) et relevés. Saisie par l'admin
 * et les agents du client, suppression d'un relevé erroné par l'admin seulement.
 */
export function OdometerCard({ vehicleId, canAdd, canDelete }: { vehicleId: string; canAdd: boolean; canDelete: boolean }) {
  const { data, isPending, isError, refetch } = useOdometer(vehicleId);
  const actions = useOdometerActions(vehicleId);
  const [km, setKm] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const add = async () => {
    setMessage(null);
    const value = Number(km.replace(/[\s\u202f]/g, ""));
    if (!/^\d+$/.test(km.replace(/[\s\u202f]/g, "")) || value > 2_000_000) {
      setMessage({ tone: "error", text: "Saisissez le kilométrage affiché au compteur, en chiffres." });
      return;
    }
    try {
      await actions.add.mutateAsync(value);
      setKm("");
      setMessage({ tone: "ok", text: `Relevé de ${formatKm(value)} enregistré.` });
    } catch (err) {
      setMessage({ tone: "error", text: formMessage(err) });
    }
  };

  const remove = async (id: string, value: number) => {
    const ok = await confirmAction("Supprimer ce relevé ?", `Le relevé de ${formatKm(value)} sera supprimé.`, "Supprimer");
    if (!ok) return;
    setMessage(null);
    try {
      await actions.remove.mutateAsync(id);
    } catch (err) {
      setMessage({ tone: "error", text: formMessage(err) });
    }
  };

  if (isPending) {
    return (
      <Card title="Compteur">
        <Text style={styles.muted}>Chargement…</Text>
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Card title="Compteur" right={<Button label="Réessayer" variant="secondary" onPress={() => void refetch()} />}>
        <Text style={styles.muted}>Le compteur n’a pas pu être chargé.</Text>
      </Card>
    );
  }

  const note = estimateNote(data);
  const shown = showAll ? data.readings : data.readings.slice(0, READINGS_SHOWN);
  const value = data.estimatedKm ?? data.lastReading?.km ?? null;

  return (
    <Card title="Compteur">
      {data.lastReading ? (
        <View style={styles.head} accessible accessibilityLabel={`Compteur estimé : ${formatKm(value)}`}>
          <Text style={styles.km}>{formatKm(value)}</Text>
          <Text style={styles.muted}>
            {data.estimatedKm != null ? "Estimation : " : ""}relevé de {formatKm(data.lastReading.km)} le {formatDateTime(data.lastReading.readAt)}
            {data.gpsKmSinceReading != null ? `, + ${formatKm(data.gpsKmSinceReading)} parcourus depuis (GPS)` : ""}
          </Text>
        </View>
      ) : (
        <Text style={styles.muted}>
          {canAdd
            ? "Aucun relevé : saisissez le kilométrage affiché au compteur. L’application l’actualisera ensuite avec la distance GPS."
            : "Aucun relevé de compteur pour ce véhicule."}
        </Text>
      )}
      {note ? <Text style={styles.note}>{note}</Text> : null}

      {canAdd ? (
        <View style={styles.addRow}>
          <View style={styles.flex}>
            <TextField
              label="Nouveau relevé (km)"
              value={km}
              onChangeText={setKm}
              keyboardType="number-pad"
              maxLength={9}
              returnKeyType="done"
              onSubmitEditing={() => void add()}
            />
          </View>
          <View style={styles.addButton}>
            <Button label="Enregistrer" onPress={() => void add()} loading={actions.add.isPending} disabled={!km.trim()} />
          </View>
        </View>
      ) : null}
      {message ? <Banner message={message.text} tone={message.tone === "error" ? "danger" : "warning"} /> : null}

      {data.readings.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.listTitle}>Relevés</Text>
          {shown.map((r) => (
            <View key={r.id} style={styles.reading}>
              <View style={styles.flex}>
                <Text style={styles.readingKm}>{formatKm(r.km)}</Text>
                <Text style={styles.muted}>
                  {formatDateTime(r.readAt)} · {ODOMETER_SOURCE_LABELS[r.source] ?? r.source}
                </Text>
              </View>
              {canDelete ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Supprimer le relevé de ${formatKm(r.km)}`}
                  onPress={() => void remove(r.id, r.km)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.delete, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.deleteText}>Supprimer</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {data.readings.length > READINGS_SHOWN ? (
            <Pressable accessibilityRole="button" onPress={() => setShowAll((v) => !v)} hitSlop={8}>
              <Text style={styles.more}>{showAll ? "Afficher moins" : `Afficher les ${data.readings.length} relevés`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { gap: 2 },
  km: { fontFamily: fonts.heavy, fontSize: 28, letterSpacing: -0.8, color: colors.text, fontVariant: ["tabular-nums"] },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  note: { fontFamily: fonts.medium, fontSize: 13, color: colors.warning },
  addRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  addButton: { minWidth: 130 },
  list: { gap: spacing.sm, marginTop: spacing.xs },
  listTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  reading: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  readingKm: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, fontVariant: ["tabular-nums"] },
  delete: { paddingVertical: spacing.xs },
  deleteText: { fontFamily: fonts.bold, fontSize: 13, color: colors.danger },
  more: { fontFamily: fonts.bold, fontSize: 13, color: colors.text, textDecorationLine: "underline" },
});
