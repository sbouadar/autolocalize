import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChoiceChips } from "@/components/ChoiceChips";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { localDayBoundary, parseFrenchDate, todayFrench } from "@/lib/dates";
import {
  UNAVAILABILITY_REASON_LABELS,
  unavailabilityReasonSchema,
  useUnavailabilityActions,
  useVehicleUnavailabilities,
  type Unavailability,
  type UnavailabilityReason,
} from "@/lib/fleet-care";
import { formatDateTime } from "@/lib/format";
import { colors, fonts, radius, spacing } from "@/lib/theme";

const REASON_OPTIONS = unavailabilityReasonSchema.options.map((key) => ({ key, label: UNAVAILABILITY_REASON_LABELS[key] }));

function period(u: Unavailability): string {
  const start = formatDateTime(u.startAt);
  return u.endAt ? `du ${start} au ${formatDateTime(u.endAt)}` : `depuis le ${start}, jusqu’à nouvel ordre`;
}

function UnavailabilityForm({ vehicleId, onDone }: { vehicleId: string; onDone: () => void }) {
  const { create } = useUnavailabilityActions(vehicleId);
  const [reason, setReason] = useState<UnavailabilityReason>("MAINTENANCE");
  const [from, setFrom] = useState(todayFrench());
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const start = parseFrenchDate(from);
    const end = to.trim() ? parseFrenchDate(to) : null;
    if (!start || (to.trim() && !end)) return setError("Saisissez les dates au format JJ/MM/AAAA.");
    if (end && end < start) return setError("La date de fin doit être après la date de début.");
    try {
      await create.mutateAsync({
        reason,
        startAt: localDayBoundary(start, "start"),
        endAt: end ? localDayBoundary(end, "end") : null,
        notes: notes.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <View style={styles.form}>
      <ChoiceChips options={REASON_OPTIONS} value={reason} onChange={setReason} label="Motif de l’indisponibilité" />
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label="Du (JJ/MM/AAAA)" value={from} onChangeText={setFrom} keyboardType="numbers-and-punctuation" maxLength={10} />
        </View>
        <View style={styles.flex}>
          <TextField
            label="Au (facultatif)"
            value={to}
            onChangeText={setTo}
            placeholder="Jusqu’à nouvel ordre"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
        </View>
      </View>
      <TextField label="Notes (facultatif)" value={notes} onChangeText={setNotes} maxLength={500} />
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label="Enregistrer" onPress={() => void save()} loading={create.isPending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={onDone} disabled={create.isPending} />
        </View>
      </View>
    </View>
  );
}

/** Bloc « Disponibilité » de la fiche : immobilisations en cours, à venir et passées. */
export function UnavailabilityCard({ vehicleId, canEdit }: { vehicleId: string; canEdit: boolean }) {
  const { data, isPending, isError, refetch } = useVehicleUnavailabilities(vehicleId);
  const actions = useUnavailabilityActions(vehicleId);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setMessage(formMessage(err));
    }
  };
  const remove = async (u: Unavailability) => {
    if (await confirmAction("Supprimer cette indisponibilité ?", `${UNAVAILABILITY_REASON_LABELS[u.reason]}, ${period(u)}.`, "Supprimer")) {
      await run(() => actions.remove(u.id));
    }
  };

  const list = data?.unavailabilities ?? [];
  const current = list.find((u) => u.current);

  return (
    <Card
      title="Disponibilité"
      right={canEdit && !adding ? <Button label="Immobiliser" variant="secondary" onPress={() => setAdding(true)} /> : null}
    >
      {adding ? <UnavailabilityForm vehicleId={vehicleId} onDone={() => setAdding(false)} /> : null}
      {message ? <Banner message={message} tone="danger" /> : null}
      {isPending ? (
        <Text style={styles.muted}>Chargement…</Text>
      ) : isError || !data ? (
        <Pressable accessibilityRole="button" onPress={() => void refetch()}>
          <Text style={styles.muted}>La disponibilité n’a pas pu être chargée. Réessayer</Text>
        </Pressable>
      ) : (
        <>
          <View style={[styles.state, { backgroundColor: current ? colors.warningSoft : colors.onlineSoft }]}>
            <Text style={[styles.stateText, { color: current ? colors.warning : colors.online }]}>
              {current ? `Indisponible : ${UNAVAILABILITY_REASON_LABELS[current.reason].toLowerCase()}` : "Disponible"}
            </Text>
          </View>
          {list.map((u) => (
            <View key={u.id} style={styles.row}>
              <Text style={[styles.name, u.past && styles.past]}>
                {UNAVAILABILITY_REASON_LABELS[u.reason]}
              </Text>
              <Text style={styles.muted}>
                {period(u)}
                {u.notes ? ` · ${u.notes}` : ""}
              </Text>
              {canEdit ? (
                <View style={styles.links}>
                  {u.current ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remettre en service (${UNAVAILABILITY_REASON_LABELS[u.reason]})`}
                      onPress={() => void run(() => actions.end(u.id))}
                      hitSlop={8}
                    >
                      <Text style={styles.link}>Remettre en service</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Supprimer l’indisponibilité (${UNAVAILABILITY_REASON_LABELS[u.reason]})`}
                    onPress={() => void remove(u)}
                    hitSlop={8}
                  >
                    <Text style={[styles.link, { color: colors.danger }]}>Supprimer</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: spacing.md },
  pair: { flexDirection: "row", gap: spacing.sm },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  state: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full },
  stateText: { fontFamily: fonts.heavy, fontSize: 13 },
  row: { gap: 2 },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  past: { color: colors.muted },
  links: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.xs },
  link: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
});
