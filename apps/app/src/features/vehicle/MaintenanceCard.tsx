import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChoiceChips } from "@/components/ChoiceChips";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { formatDateOnly, parseFrenchDate, todayFrench } from "@/lib/dates";
import {
  MAINTENANCE_TYPE_LABELS,
  maintenanceDelay,
  maintenanceName,
  maintenanceTypeSchema,
  useMaintenanceActions,
  useMaintenancePlans,
  useMaintenanceRecords,
  type MaintenancePlan,
  type MaintenanceType,
} from "@/lib/fleet-care";
import { formatKm } from "@/lib/format";
import { colors, fonts, radius, spacing } from "@/lib/theme";

const TYPE_OPTIONS = maintenanceTypeSchema.options.map((key) => ({ key, label: MAINTENANCE_TYPE_LABELS[key] }));

/** Couleurs de l'état d'un entretien (fixes). */
export const MAINTENANCE_STATUS_STYLE: Record<MaintenancePlan["status"], { color: string; soft: string }> = {
  OK: { color: colors.online, soft: colors.onlineSoft },
  DUE: { color: colors.warning, soft: colors.warningSoft },
  OVERDUE: { color: colors.danger, soft: colors.dangerSoft },
  UNKNOWN: { color: colors.offline, soft: colors.border },
};

/** Entier saisi (« 10 000 ») ; null si vide ; NaN si illisible. */
function parseInteger(input: string): number | null {
  const v = input.replace(/[\s\u202f]/g, "");
  if (!v) return null;
  return /^\d+$/.test(v) ? Number(v) : Number.NaN;
}

function PlanForm({ vehicleId, onDone }: { vehicleId: string; onDone: () => void }) {
  const { createPlan } = useMaintenanceActions(vehicleId);
  const [type, setType] = useState<MaintenanceType>("OIL_CHANGE");
  const [form, setForm] = useState({ label: "", intervalKm: "", intervalMonths: "", lastDate: "", lastKm: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setError(null);
    const intervalKm = parseInteger(form.intervalKm);
    const months = parseInteger(form.intervalMonths);
    const lastDoneKm = parseInteger(form.lastKm);
    if ([intervalKm, months, lastDoneKm].some((n) => Number.isNaN(n))) return setError("Saisissez les nombres en chiffres.");
    if (intervalKm == null && months == null) return setError("Indiquez un intervalle en kilomètres, en mois, ou les deux.");
    if (type === "OTHER" && !form.label.trim()) return setError("Précisez le nom de l’entretien.");
    const lastDoneAt = form.lastDate.trim() ? parseFrenchDate(form.lastDate) : null;
    if (form.lastDate.trim() && !lastDoneAt) return setError("Saisissez la date au format JJ/MM/AAAA.");
    try {
      await createPlan.mutateAsync({
        type,
        label: type === "OTHER" ? form.label.trim() : null,
        intervalKm,
        // L'API compte en jours ; un mois est compté pour 30 jours.
        intervalDays: months != null ? months * 30 : null,
        lastDoneAt,
        lastDoneKm,
      });
      onDone();
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <View style={styles.form}>
      <ChoiceChips options={TYPE_OPTIONS} value={type} onChange={setType} label="Type d’entretien" />
      {type === "OTHER" ? <TextField label="Nom de l’entretien" value={form.label} onChangeText={set("label")} maxLength={100} /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label="Tous les (km)" value={form.intervalKm} onChangeText={set("intervalKm")} keyboardType="number-pad" maxLength={7} placeholder="10 000" />
        </View>
        <View style={styles.flex}>
          <TextField label="Tous les (mois)" value={form.intervalMonths} onChangeText={set("intervalMonths")} keyboardType="number-pad" maxLength={3} placeholder="12" />
        </View>
      </View>
      <Text style={styles.muted}>Dernier entretien de ce type, s’il est connu : il sert de point de départ.</Text>
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label="Fait le (JJ/MM/AAAA)" value={form.lastDate} onChangeText={set("lastDate")} keyboardType="numbers-and-punctuation" maxLength={10} />
        </View>
        <View style={styles.flex}>
          <TextField label="Compteur alors (km)" value={form.lastKm} onChangeText={set("lastKm")} keyboardType="number-pad" maxLength={9} />
        </View>
      </View>
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label="Ajouter" onPress={() => void save()} loading={createPlan.isPending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={onDone} disabled={createPlan.isPending} />
        </View>
      </View>
    </View>
  );
}

/** Enregistrement d'un entretien réalisé pour un plan : date, compteur, garage. */
function DoneForm({ vehicleId, plan, onDone }: { vehicleId: string; plan: MaintenancePlan; onDone: () => void }) {
  const { addRecord } = useMaintenanceActions(vehicleId);
  const [date, setDate] = useState(todayFrench());
  const [kmInput, setKmInput] = useState("");
  const [garage, setGarage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const doneOn = parseFrenchDate(date);
    if (!doneOn) return setError("Saisissez la date au format JJ/MM/AAAA.");
    const km = parseInteger(kmInput);
    if (Number.isNaN(km)) return setError("Saisissez le compteur en chiffres.");
    if (plan.intervalKm != null && km == null) return setError("Indiquez le compteur : il sert à calculer le prochain entretien.");
    try {
      await addRecord.mutateAsync({ planId: plan.id, doneOn, km, garage: garage.trim() || null, notes: null });
      onDone();
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <View style={styles.form}>
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label={`${maintenanceName(plan)} fait le`} value={date} onChangeText={setDate} keyboardType="numbers-and-punctuation" maxLength={10} />
        </View>
        <View style={styles.flex}>
          <TextField label="Compteur (km)" value={kmInput} onChangeText={setKmInput} keyboardType="number-pad" maxLength={9} />
        </View>
      </View>
      <TextField label="Garage (facultatif)" value={garage} onChangeText={setGarage} maxLength={191} />
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label="Enregistrer" onPress={() => void save()} loading={addRecord.isPending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={onDone} disabled={addRecord.isPending} />
        </View>
      </View>
    </View>
  );
}

function interval(plan: MaintenancePlan): string {
  const parts = [
    plan.intervalKm != null ? `tous les ${formatKm(plan.intervalKm)}` : null,
    plan.intervalDays != null ? (plan.intervalDays % 30 === 0 ? `tous les ${plan.intervalDays / 30} mois` : `tous les ${plan.intervalDays} jours`) : null,
  ].filter(Boolean);
  return parts.join(" ou ");
}

interface MaintenanceCardProps {
  vehicleId: string;
  /** Création et suppression des plans (admin du client). */
  canEdit: boolean;
  /** Saisie d'un entretien réalisé (admin et agents). */
  canRecord: boolean;
}

/** Bloc « Entretien » de la fiche : plans périodiques avec leur échéance, entretiens réalisés. */
export function MaintenanceCard({ vehicleId, canEdit, canRecord }: MaintenanceCardProps) {
  const { data, isPending, isError, refetch } = useMaintenancePlans(vehicleId);
  const records = useMaintenanceRecords(vehicleId).data?.records ?? [];
  const actions = useMaintenanceActions(vehicleId);
  const [adding, setAdding] = useState(false);
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const remove = async (plan: MaintenancePlan) => {
    if (!(await confirmAction("Supprimer ce plan d’entretien ?", `${maintenanceName(plan)} ne sera plus suivi. L’historique des entretiens est conservé.`, "Supprimer"))) return;
    setMessage(null);
    try {
      await actions.removePlan(plan.id);
    } catch (err) {
      setMessage(formMessage(err));
    }
  };

  return (
    <Card title="Entretien" right={canEdit && !adding ? <Button label="Ajouter" variant="secondary" onPress={() => setAdding(true)} /> : null}>
      {adding ? <PlanForm vehicleId={vehicleId} onDone={() => setAdding(false)} /> : null}
      {message ? <Banner message={message} tone="danger" /> : null}
      {isPending ? (
        <Text style={styles.muted}>Chargement…</Text>
      ) : isError || !data ? (
        <Pressable accessibilityRole="button" onPress={() => void refetch()}>
          <Text style={styles.muted}>L’entretien n’a pas pu être chargé. Réessayer</Text>
        </Pressable>
      ) : data.plans.length === 0 ? (
        <Text style={styles.muted}>
          {canEdit ? "Aucun entretien suivi : ajoutez la vidange, les pneus, la révision… pour être alerté à l’approche de l’échéance." : "Aucun entretien suivi pour ce véhicule."}
        </Text>
      ) : (
        data.plans.map((p) => {
          const tone = MAINTENANCE_STATUS_STYLE[p.status];
          const name = maintenanceName(p);
          return (
            <View key={p.id} style={styles.row}>
              <View style={styles.rowHead}>
                <View style={styles.flex}>
                  <Text style={styles.name}>{name}</Text>
                  <Text style={styles.muted}>{interval(p)}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: tone.soft }]}>
                  <Text style={[styles.badgeText, { color: tone.color }]}>{maintenanceDelay(p)}</Text>
                </View>
              </View>
              {p.status === "UNKNOWN" ? (
                <Text style={styles.muted}>
                  {p.currentKm == null ? "Saisissez un relevé de compteur pour suivre cet entretien." : "Enregistrez le dernier entretien pour calculer le prochain."}
                </Text>
              ) : null}
              {doneFor === p.id ? <DoneForm vehicleId={vehicleId} plan={p} onDone={() => setDoneFor(null)} /> : null}
              {doneFor !== p.id && (canRecord || canEdit) ? (
                <View style={styles.links}>
                  {canRecord ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`${name} : marquer comme fait`} onPress={() => setDoneFor(p.id)} hitSlop={8}>
                      <Text style={styles.link}>Marquer comme fait</Text>
                    </Pressable>
                  ) : null}
                  {canEdit ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Supprimer le plan ${name}`} onPress={() => void remove(p)} hitSlop={8}>
                      <Text style={[styles.link, { color: colors.danger }]}>Supprimer</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })
      )}

      {records.length > 0 ? (
        <View style={styles.history}>
          <Text style={styles.historyTitle}>Derniers entretiens</Text>
          {records.slice(0, 5).map((r) => (
            <Text key={r.id} style={styles.muted}>
              {formatDateOnly(r.doneOn)} · {maintenanceName(r)}
              {r.km != null ? ` · ${formatKm(r.km)}` : ""}
              {r.garage ? ` · ${r.garage}` : ""}
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
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  row: { gap: spacing.sm },
  rowHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, maxWidth: "55%" },
  badgeText: { fontFamily: fonts.heavy, fontSize: 12 },
  links: { flexDirection: "row", gap: spacing.lg },
  link: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
  history: { gap: spacing.xs, marginTop: spacing.xs },
  historyTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
});
