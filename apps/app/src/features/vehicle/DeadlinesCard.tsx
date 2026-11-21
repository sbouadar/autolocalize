import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChoiceChips } from "@/components/ChoiceChips";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { formatDateOnly, parseFrenchDate } from "@/lib/dates";
import {
  DEADLINE_TYPE_LABELS,
  deadlineDelay,
  deadlineName,
  deadlineTypeSchema,
  useDeadlineActions,
  useVehicleDeadlines,
  type Deadline,
  type DeadlineType,
} from "@/lib/fleet-care";
import { colors, fonts, radius, spacing } from "@/lib/theme";

const TYPE_OPTIONS = deadlineTypeSchema.options.map((key) => ({ key, label: DEADLINE_TYPE_LABELS[key] }));

/** Couleurs de l'état d'une échéance (fixes, comme les états des véhicules). */
export const DEADLINE_STATUS_STYLE: Record<Deadline["status"], { color: string; soft: string }> = {
  OK: { color: colors.online, soft: colors.onlineSoft },
  WARNING: { color: colors.warning, soft: colors.warningSoft },
  EXPIRED: { color: colors.danger, soft: colors.dangerSoft },
};

function DeadlineForm({ vehicleId, onDone }: { vehicleId: string; onDone: () => void }) {
  const { create } = useDeadlineActions(vehicleId);
  const [type, setType] = useState<DeadlineType>("INSURANCE");
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const expiresOn = parseFrenchDate(date);
    if (!expiresOn) return setError("Saisissez la date d’expiration au format JJ/MM/AAAA.");
    if (type === "OTHER" && !label.trim()) return setError("Précisez le nom de l’échéance.");
    try {
      await create.mutateAsync({ type, label: type === "OTHER" ? label.trim() : null, expiresOn, reference: reference.trim() || null });
      onDone();
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <View style={styles.form}>
      <ChoiceChips options={TYPE_OPTIONS} value={type} onChange={setType} label="Type d’échéance" />
      {type === "OTHER" ? <TextField label="Nom de l’échéance" value={label} onChangeText={setLabel} maxLength={100} /> : null}
      <TextField
        label="Date d’expiration (JJ/MM/AAAA)"
        value={date}
        onChangeText={setDate}
        placeholder="31/12/2027"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      <TextField label="Référence (facultatif)" value={reference} onChangeText={setReference} maxLength={100} placeholder="N° de police, de PV…" />
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label="Ajouter" onPress={() => void save()} loading={create.isPending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={onDone} disabled={create.isPending} />
        </View>
      </View>
    </View>
  );
}

function DeadlineRow({ deadline, vehicleId, canEdit, onError }: { deadline: Deadline; vehicleId: string; canEdit: boolean; onError: (m: string | null) => void }) {
  const actions = useDeadlineActions(vehicleId);
  const [renewing, setRenewing] = useState(false);
  const [date, setDate] = useState("");
  const tone = DEADLINE_STATUS_STYLE[deadline.status];
  const name = deadlineName(deadline);

  const run = async (action: () => Promise<unknown>) => {
    onError(null);
    try {
      await action();
    } catch (err) {
      onError(formMessage(err));
    }
  };
  const renew = async () => {
    const expiresOn = parseFrenchDate(date);
    if (!expiresOn) return onError("Saisissez la nouvelle date au format JJ/MM/AAAA.");
    await run(async () => {
      await actions.renew(deadline.id, expiresOn);
      setRenewing(false);
      setDate("");
    });
  };
  const remove = async () => {
    if (await confirmAction("Supprimer cette échéance ?", `${name} ne sera plus suivie pour ce véhicule.`, "Supprimer")) {
      await run(() => actions.remove(deadline.id));
    }
  };

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <View style={styles.flex}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.muted}>
            {formatDateOnly(deadline.expiresOn)}
            {deadline.reference ? ` · ${deadline.reference}` : ""}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: tone.soft }]}>
          <Text style={[styles.badgeText, { color: tone.color }]}>{deadlineDelay(deadline.daysLeft)}</Text>
        </View>
      </View>
      {canEdit && renewing ? (
        <View style={styles.renew}>
          <View style={styles.flex}>
            <TextField
              label={`Nouvelle date pour ${name}`}
              value={date}
              onChangeText={setDate}
              placeholder="JJ/MM/AAAA"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
          </View>
          <Button label="Valider" onPress={() => void renew()} />
        </View>
      ) : null}
      {canEdit ? (
        <View style={styles.links}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Renouveler ${name}`} onPress={() => setRenewing((v) => !v)} hitSlop={8}>
            <Text style={styles.link}>{renewing ? "Annuler" : "Renouveler"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Supprimer ${name}`} onPress={() => void remove()} hitSlop={8}>
            <Text style={[styles.link, { color: colors.danger }]}>Supprimer</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** Bloc « Échéances » de la fiche : assurance, visite technique, vignette… avec leur délai. */
export function DeadlinesCard({ vehicleId, canEdit }: { vehicleId: string; canEdit: boolean }) {
  const { data, isPending, isError, refetch } = useVehicleDeadlines(vehicleId);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Card
      title="Échéances"
      right={canEdit && !adding ? <Button label="Ajouter" variant="secondary" onPress={() => setAdding(true)} /> : null}
    >
      {adding ? <DeadlineForm vehicleId={vehicleId} onDone={() => setAdding(false)} /> : null}
      {message ? <Banner message={message} tone="danger" /> : null}
      {isPending ? (
        <Text style={styles.muted}>Chargement…</Text>
      ) : isError || !data ? (
        <Pressable accessibilityRole="button" onPress={() => void refetch()}>
          <Text style={styles.muted}>Les échéances n’ont pas pu être chargées. Réessayer</Text>
        </Pressable>
      ) : data.deadlines.length === 0 ? (
        <Text style={styles.muted}>
          {canEdit
            ? "Aucune échéance : ajoutez l’assurance, la visite technique, la vignette… pour être alerté avant leur expiration."
            : "Aucune échéance suivie pour ce véhicule."}
        </Text>
      ) : (
        data.deadlines.map((d) => <DeadlineRow key={d.id} deadline={d} vehicleId={vehicleId} canEdit={canEdit} onError={setMessage} />)
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: spacing.md },
  pair: { flexDirection: "row", gap: spacing.sm },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  row: { gap: spacing.sm },
  rowHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full },
  badgeText: { fontFamily: fonts.heavy, fontSize: 12 },
  renew: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  links: { flexDirection: "row", gap: spacing.lg },
  link: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
});
