import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChoiceChips } from "@/components/ChoiceChips";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SelectField } from "@/components/SelectField";
import { Banner, ErrorState, LoadingState } from "@/components/States";
import {
  ALERT_RULE_LABELS,
  alertRuleTypeSchema,
  DWELL_DURATIONS,
  OFFLINE_DURATIONS,
  toMinutes,
  useAlertPreferences,
  useAlertRuleActions,
  useAlertRules,
  useSaveAlertPreferences,
  WEEKDAYS,
  type AlertRule,
  type AlertRuleType,
} from "@/lib/alert-rules";
import { ALERT_TYPE_GROUPS } from "@/lib/alerts";
import { formMessage, userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { confirmAction } from "@/lib/confirm";
import { TIME_OPTIONS } from "@/lib/dates";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useVehicles, vehicleLabel } from "@/lib/vehicles";
import { useZones } from "@/lib/zones";

const ALL = "__all__";
const TYPE_OPTIONS = alertRuleTypeSchema.options.map((key) => ({ key, label: ALERT_RULE_LABELS[key] }));
const TYPE_HINTS: Record<AlertRuleType, string> = {
  AFTER_HOURS: "Alerte si un véhicule a le contact mis ou roule en dehors des jours et heures autorisés.",
  OFFLINE_DURATION: "Alerte si un traceur n’envoie plus de position depuis la durée choisie (débranché, panne, zone sans réseau).",
  ZONE_DWELL: "Alerte si un véhicule reste dans une zone plus longtemps que la durée choisie.",
};

function RuleForm({ onDone }: { onDone: () => void }) {
  const branding = useBranding();
  const { create } = useAlertRuleActions();
  const vehicles = useVehicles().data?.vehicles ?? [];
  const zones = useZones().data?.zones ?? [];
  const [type, setType] = useState<AlertRuleType>("AFTER_HOURS");
  const [vehicleId, setVehicleId] = useState<string | null>(ALL);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("19:00");
  const [offline, setOffline] = useState("360");
  const [dwell, setDwell] = useState("120");
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) => setDays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort()));

  const save = async () => {
    setError(null);
    if (type === "AFTER_HOURS" && days.length === 0) return setError("Choisissez au moins un jour autorisé.");
    if (type === "AFTER_HOURS" && start === end) return setError("Le début et la fin de la plage doivent être différents.");
    if (type === "ZONE_DWELL" && !zoneId) return setError("Choisissez la zone.");
    try {
      await create.mutateAsync({
        type,
        vehicleId: vehicleId === ALL ? null : vehicleId,
        ...(type === "AFTER_HOURS" && { days, startMinute: toMinutes(start), endMinute: toMinutes(end) }),
        ...(type === "OFFLINE_DURATION" && { thresholdMinutes: Number(offline) }),
        ...(type === "ZONE_DWELL" && { zoneId, thresholdMinutes: Number(dwell) }),
      });
      onDone();
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <View style={styles.form}>
      <ChoiceChips options={TYPE_OPTIONS} value={type} onChange={setType} label="Type de règle" tone="fill" />
      <Text style={styles.muted}>{TYPE_HINTS[type]}</Text>
      <SelectField
        label="Véhicules"
        options={[{ key: ALL, label: "Tous les véhicules" }, ...vehicles.map((v) => ({ key: v.id, label: vehicleLabel(v) }))]}
        value={vehicleId}
        onChange={setVehicleId}
      />
      {type === "AFTER_HOURS" ? (
        <>
          <Text style={styles.label}>Jours autorisés</Text>
          <View style={styles.days} accessibilityRole="none">
            {WEEKDAYS.map((w) => {
              const on = days.includes(w.day);
              return (
                <Pressable
                  key={w.day}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={w.label}
                  onPress={() => toggleDay(w.day)}
                  style={[styles.day, { backgroundColor: on ? branding.primaryColor : colors.fill }]}
                >
                  <Text style={[styles.dayText, on && { color: branding.onPrimary }]}>{w.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.pair}>
            <View style={styles.flex}>
              <SelectField label="Autorisé de" options={TIME_OPTIONS} value={start} onChange={setStart} />
            </View>
            <View style={styles.flex}>
              <SelectField label="à" options={TIME_OPTIONS} value={end} onChange={setEnd} />
            </View>
          </View>
        </>
      ) : null}
      {type === "OFFLINE_DURATION" ? (
        <>
          <Text style={styles.label}>Sans nouvelle depuis plus de</Text>
          <ChoiceChips options={OFFLINE_DURATIONS} value={offline} onChange={setOffline} label="Durée sans nouvelle" tone="fill" />
        </>
      ) : null}
      {type === "ZONE_DWELL" ? (
        zones.length === 0 ? (
          <Text style={styles.muted}>Créez d’abord une zone (carte → Zones).</Text>
        ) : (
          <>
            <SelectField label="Zone" options={zones.map((z) => ({ key: z.id, label: z.name }))} value={zoneId} onChange={setZoneId} placeholder="Choisir une zone" />
            <Text style={styles.label}>Dans la zone depuis plus de</Text>
            <ChoiceChips options={DWELL_DURATIONS} value={dwell} onChange={setDwell} label="Durée dans la zone" tone="fill" />
            <Text style={styles.muted}>La zone doit surveiller le véhicule (écran des zones) pour que ses entrées soient connues.</Text>
          </>
        )
      ) : null}
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label="Créer la règle" onPress={() => void save()} loading={create.isPending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={onDone} disabled={create.isPending} />
        </View>
      </View>
    </View>
  );
}

function RuleRow({ rule, canEdit }: { rule: AlertRule; canEdit: boolean }) {
  const { update, remove } = useAlertRuleActions();
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(formMessage(err));
    }
  };
  return (
    <View style={styles.rule}>
      <View style={styles.ruleHead}>
        <View style={styles.flex}>
          <Text style={styles.name}>{ALERT_RULE_LABELS[rule.type]}</Text>
          <Text style={styles.muted}>
            {rule.summary} · {rule.vehicleName ?? "tous les véhicules"}
          </Text>
        </View>
        <Switch
          value={rule.enabled}
          disabled={!canEdit}
          onValueChange={(enabled) => void run(() => update(rule.id, { enabled }))}
          accessibilityLabel={`${ALERT_RULE_LABELS[rule.type]} : ${rule.enabled ? "active" : "en pause"}`}
        />
      </View>
      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Supprimer la règle ${ALERT_RULE_LABELS[rule.type]}`}
          onPress={() => void (async () => (await confirmAction("Supprimer cette règle ?", rule.summary, "Supprimer")) && run(() => remove(rule.id)))()}
          hitSlop={8}
        >
          <Text style={styles.delete}>Supprimer</Text>
        </Pressable>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function Preferences() {
  const { data } = useAlertPreferences();
  const save = useSaveAlertPreferences();
  const muted = new Set(data?.mutedTypes ?? []);
  const toggle = (types: string[], shown: boolean) => {
    const next = new Set(muted);
    for (const t of types) if (shown) next.delete(t);
    else next.add(t);
    void save.mutateAsync([...next]);
  };
  return (
    <Card title="Alertes affichées pour moi">
      <Text style={styles.muted}>Ce choix ne concerne que votre compte : les règles et les alertes restent enregistrées.</Text>
      {ALERT_TYPE_GROUPS.map((g) => {
        const shown = !g.types.every((t) => muted.has(t));
        return (
          <View key={g.label} style={styles.prefRow}>
            <Text style={[styles.text, styles.flex]}>{g.label}</Text>
            <Switch value={shown} onValueChange={(v) => toggle(g.types, v)} accessibilityLabel={`Afficher : ${g.label}`} disabled={!data} />
          </View>
        );
      })}
    </Card>
  );
}

/** Règles d'alerte du client (création par l'admin) et préférences d'affichage de l'utilisateur. */
export function AlertRulesScreen() {
  const { me } = useAuth();
  const branding = useBranding();
  useDocumentTitle(`Règles d’alerte — ${branding.name}`);
  const { data, isPending, error, refetch } = useAlertRules();
  const [adding, setAdding] = useState(false);
  const canEdit = me?.user.role === "TENANT_ADMIN";
  const isSuper = me?.user.role === "SUPER_ADMIN";

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ScreenHeader title="Règles d’alerte" fallback="/alerts" right={canEdit && !adding ? <Button label="Ajouter" variant="secondary" onPress={() => setAdding(true)} /> : null} />
      {adding ? (
        <Card title="Nouvelle règle">
          <RuleForm onDone={() => setAdding(false)} />
        </Card>
      ) : null}
      {isSuper ? null : isPending ? (
        <LoadingState />
      ) : !data ? (
        <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />
      ) : data.rules.length === 0 ? (
        <Text style={styles.muted}>
          {canEdit ? "Aucune règle : ajoutez-en pour être alerté d’un contact hors horaires, d’un traceur muet ou d’un arrêt prolongé dans une zone." : "Aucune règle d’alerte."}
        </Text>
      ) : (
        <View style={styles.list}>
          {data.rules.map((r) => (
            <RuleRow key={r.id} rule={r} canEdit={canEdit} />
          ))}
        </View>
      )}
      <Preferences />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 720, alignSelf: "center" },
  flex: { flex: 1 },
  form: { gap: spacing.md },
  pair: { flexDirection: "row", gap: spacing.sm },
  label: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  text: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  days: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  day: { minWidth: 48, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.full, paddingHorizontal: spacing.sm },
  dayText: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
  list: { gap: spacing.sm },
  rule: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.fill },
  ruleHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  delete: { fontFamily: fonts.bold, fontSize: 13, color: colors.danger },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
  prefRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 40 },
});
