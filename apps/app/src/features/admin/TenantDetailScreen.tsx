import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BrandingForm, toBrandingValues } from "@/components/BrandingForm";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { LogoPicker } from "@/components/LogoPicker";
import { SegmentedControl } from "@/components/SegmentedControl";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/States";
import { TenantLogo } from "@/components/TenantLogo";
import { TextField } from "@/components/TextField";
import {
  TENANT_STATUS_LABELS,
  useAudit,
  useTenantActions,
  useTenantDetail,
  type Credentials,
  type TenantDetail,
  type TenantStatus,
} from "@/lib/admin";
import { ApiError, formMessage, userMessage } from "@/lib/api";
import { resolveBranding } from "@/lib/branding";
import { useBranding } from "@/lib/branding-context";
import { confirmAction } from "@/lib/confirm";
import { relativeTime } from "@/lib/format";
import { colors, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { vehicleStatus } from "@/lib/vehicles";
import { StatusBadge } from "./AdminHomeScreen";
import { AssignVehicleForm } from "./AssignVehicleForm";
import { AuditList } from "./AuditList";
import { CredentialsCard } from "./CredentialsCard";

const STATUS_OPTIONS = (Object.keys(TENANT_STATUS_LABELS) as TenantStatus[]).map((key) => ({
  key,
  label: TENANT_STATUS_LABELS[key],
}));

const STATUS_WARNINGS: Record<TenantStatus, string> = {
  ACTIVE: "Le client retrouvera immédiatement l’accès à son espace.",
  SUSPENDED: "Le client perdra immédiatement l’accès (impayé par exemple). Ses données sont conservées.",
  CANCELLED: "Le client perdra l’accès et sa page de connexion ne sera plus affichée. Ses données sont conservées.",
};

type Vehicle = TenantDetail["vehicles"][number];
type Actions = ReturnType<typeof useTenantActions>;

function VehicleRow({ vehicle, actions }: { vehicle: Vehicle; actions: Actions }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(vehicle.name);
  const [plate, setPlate] = useState(vehicle.plate ?? "");
  const [error, setError] = useState<string | null>(null);
  const status = vehicle.device ? vehicleStatus(vehicle.device) : null;

  const save = async () => {
    if (!name.trim()) return setError("Le nom est obligatoire.");
    try {
      await actions.updateVehicle(vehicle.id, { name: name.trim(), plate: plate.trim() || null });
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(formMessage(err));
    }
  };

  const remove = async () => {
    const ok = await confirmAction(
      `Retirer « ${vehicle.name} » ?`,
      "Le véhicule disparaîtra de l’espace du client. Le traceur reste déclaré dans Traccar et pourra être réaffecté.",
      "Retirer",
    );
    if (!ok) return;
    try {
      await actions.removeVehicle(vehicle.id);
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <View style={styles.vehicle}>
      {editing ? (
        <View style={styles.form}>
          <TextField label="Nom" value={name} onChangeText={setName} maxLength={191} />
          <TextField label="Plaque" value={plate} onChangeText={setPlate} autoCapitalize="characters" maxLength={32} />
          <View style={styles.actions}>
            <Button label="Annuler" variant="secondary" onPress={() => setEditing(false)} />
            <Button label="Enregistrer" onPress={save} />
          </View>
        </View>
      ) : (
        <View style={styles.vehicleHead}>
          <View style={styles.flex}>
            <Text style={styles.vehicleName}>
              {vehicle.name}
              {vehicle.plate ? ` · ${vehicle.plate}` : ""}
            </Text>
            <Text style={styles.muted}>
              {vehicle.device
                ? `IMEI ${vehicle.device.uniqueId} · ${status!.label} · vu ${relativeTime(vehicle.device.lastUpdate)}`
                : `Appareil Traccar n° ${vehicle.traccarDeviceId} (état indisponible)`}
            </Text>
          </View>
          <View style={styles.rowActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Modifier ${vehicle.name}`} onPress={() => setEditing(true)} hitSlop={6}>
              <Text style={styles.link}>Modifier</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Retirer ${vehicle.name}`} onPress={remove} hitSlop={6}>
              <Text style={[styles.link, { color: colors.danger }]}>Retirer</Text>
            </Pressable>
          </View>
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/** Fiche d'un client dans le back-office. */
export function TenantDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const platform = useBranding();
  const { data, isPending, error, refetch } = useTenantDetail(id);
  const audit = useAudit(id);
  const actions = useTenantActions(id);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useDocumentTitle(`${data?.tenant.name ?? "Client"} — Administration`);

  if (isPending) return <LoadingState />;
  if (!data) {
    if (error instanceof ApiError && error.status === 404) return <EmptyState title="Client introuvable" />;
    return <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />;
  }
  const { tenant, users, vehicles } = data;
  const branding = resolveBranding(tenant);

  const run = async (action: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setMessage(formMessage(err));
    }
  };

  const changeStatus = async (status: TenantStatus) => {
    if (status === tenant.status) return;
    const ok = await confirmAction(`Passer « ${tenant.name} » en « ${TENANT_STATUS_LABELS[status]} » ?`, STATUS_WARNINGS[status]);
    if (ok) await run(() => actions.update({ status }));
  };

  const resetPassword = async () => {
    const ok = await confirmAction(
      "Réinitialiser le mot de passe ?",
      "Le client sera déconnecté de tous ses appareils et devra utiliser le nouveau mot de passe provisoire.",
      "Réinitialiser",
    );
    if (ok) await run(async () => setCredentials(await actions.resetPassword()));
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="link" onPress={() => router.navigate("/admin")} hitSlop={8}>
        <Text style={[styles.back, { color: platform.primaryColor }]}>‹ Clients</Text>
      </Pressable>

      <View style={styles.header}>
        <TenantLogo branding={branding} size={56} />
        <View style={styles.flex}>
          <Text style={styles.title}>{tenant.name}</Text>
          <Text style={styles.muted} selectable>
            https://autolocalize.net/login/{tenant.slug}
          </Text>
        </View>
        <StatusBadge status={tenant.status} />
      </View>

      {message ? <Banner message={message} tone="danger" /> : null}
      {credentials ? <CredentialsCard credentials={credentials} slug={tenant.slug} /> : null}

      <Card title="Abonnement">
        <SegmentedControl options={STATUS_OPTIONS} value={tenant.status} onChange={(s) => void changeStatus(s)} />
        <Text style={styles.muted}>{STATUS_WARNINGS[tenant.status]}</Text>
      </Card>

      <Card title={`Traceurs (${vehicles.length})`} right={assigning ? null : <Button label="Affecter un traceur" onPress={() => setAssigning(true)} />}>
        {!data.traccarAvailable ? <Banner message="Traccar est momentanément indisponible : états des traceurs inconnus." /> : null}
        {vehicles.length === 0 && !assigning ? <Text style={styles.muted}>Aucun traceur affecté.</Text> : null}
        {vehicles.map((v) => (
          <VehicleRow key={`${v.id}-${v.name}-${v.plate}`} vehicle={v} actions={actions} />
        ))}
        {assigning ? <AssignVehicleForm onAssign={actions.assignVehicle} onDone={() => setAssigning(false)} /> : null}
      </Card>

      <Card title="Compte du client">
        {users.map((u) => (
          <View key={u.id} style={styles.user}>
            <Text style={styles.vehicleName}>{u.name}</Text>
            <Text style={styles.muted} selectable>
              {u.email}
              {u.mustChangePassword ? " · mot de passe provisoire non encore changé" : ""}
            </Text>
          </View>
        ))}
        <Button label="Réinitialiser le mot de passe" variant="secondary" onPress={resetPassword} />
      </Card>

      <Card title="Identité et couleurs">
        <BrandingForm key={tenant.id} initial={toBrandingValues(tenant)} onSubmit={(payload) => actions.update(payload)} />
      </Card>

      <Card title="Logo">
        <View style={styles.logoRow}>
          <TenantLogo branding={branding} size={72} />
          <View style={styles.flex}>
            <LogoPicker onPick={(dataUrl) => run(() => actions.setLogo(dataUrl))} />
          </View>
        </View>
        {tenant.logoUrl ? (
          <Button label="Supprimer le logo" variant="secondary" onPress={() => void run(actions.removeLogo)} />
        ) : null}
      </Card>

      <Card title="Journal du client">
        {audit.data ? <AuditList entries={audit.data.entries.slice(0, 15)} /> : <Text style={styles.muted}>Chargement…</Text>}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, width: "100%", maxWidth: 820, alignSelf: "center" },
  back: { fontSize: 16, fontWeight: "600" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  flex: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  vehicle: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  vehicleHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  vehicleName: { fontSize: 15, fontWeight: "600", color: colors.text },
  rowActions: { flexDirection: "row", gap: spacing.md },
  link: { fontSize: 14, fontWeight: "600", color: colors.text },
  form: { gap: spacing.sm },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  error: { fontSize: 13, color: colors.danger },
  user: { gap: 2, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.background },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
});
