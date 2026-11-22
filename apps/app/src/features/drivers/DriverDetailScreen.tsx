import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SegmentedControl } from "@/components/SegmentedControl";
import { StatTile } from "@/components/StatTile";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/States";
import { alertTypeLabel } from "@/lib/alerts";
import { ApiError, formMessage, userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { confirmAction } from "@/lib/confirm";
import { formatDateOnly } from "@/lib/dates";
import { useDriver, useDriverActions, useDriverActivity, type Assignment } from "@/lib/drivers";
import { formatDateTime, formatDistance, formatDuration, formatSpeed } from "@/lib/format";
import { DASHBOARD_PERIODS, type PeriodKey } from "@/lib/period";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { DriverForm } from "./DriverForm";
import { licenseWarning } from "./DriversScreen";

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Activity({ id }: { id: string }) {
  const [period, setPeriod] = useState<PeriodKey>("week");
  const { data, isPending, error, refetch } = useDriverActivity(id, period);
  const alerts = Object.entries(data?.alerts ?? {});
  return (
    <Card title="Activité">
      <SegmentedControl options={DASHBOARD_PERIODS} value={period} onChange={setPeriod} />
      {isPending ? (
        <Text style={styles.muted}>Calcul…</Text>
      ) : !data ? (
        <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />
      ) : (
        <>
          {!data.liveDataAvailable ? <Banner message="Historique GPS momentanément indisponible : trajets incomplets." /> : null}
          <View style={styles.tiles}>
            <StatTile label="Trajets" value={String(data.trips)} />
            <StatTile label="Distance" value={formatDistance(data.distanceKm)} />
            <StatTile label="Temps de conduite" value={formatDuration(data.drivingMs)} />
            <StatTile label="Vitesse max" value={formatSpeed(data.maxSpeedKmh)} />
          </View>
          {data.segments.length === 0 ? <Text style={styles.muted}>Aucun véhicule affecté sur cette période.</Text> : null}
          {data.segments.map((s) => (
            <Text key={`${s.vehicleId}-${s.from}`} style={styles.muted}>
              {s.vehicleName} : {formatDateTime(s.from)} → {formatDateTime(s.to)}
              {s.distanceKm != null ? ` · ${formatDistance(s.distanceKm)}` : ""}
            </Text>
          ))}
          {alerts.length > 0 ? (
            <Text style={styles.alerts}>Alertes : {alerts.map(([type, n]) => `${alertTypeLabel(type)} (${n})`).join(", ")}</Text>
          ) : data.segments.length > 0 ? (
            <Text style={styles.muted}>Aucune alerte sur cette période.</Text>
          ) : null}
        </>
      )}
    </Card>
  );
}

function span(a: Assignment): string {
  return a.endAt ? `${formatDateTime(a.startAt)} → ${formatDateTime(a.endAt)}` : `depuis le ${formatDateTime(a.startAt)}`;
}

/** Fiche d'un conducteur : coordonnées, véhicule actuel, activité, historique des affectations. */
export function DriverDetailScreen({ id }: { id: string }) {
  const { me } = useAuth();
  const branding = useBranding();
  const router = useRouter();
  const { data, isPending, error, refetch } = useDriver(id);
  const { update, remove } = useDriverActions();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useDocumentTitle(`${data?.driver.name ?? "Conducteur"} — ${branding.name}`);

  if (me && !me.tenant?.driversEnabled) return <Redirect href="/" />;
  if (isPending) return <LoadingState />;
  if (!data) {
    if (error instanceof ApiError && error.status === 404) return <EmptyState title="Conducteur introuvable" />;
    return <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />;
  }
  const d = data.driver;
  const isAdmin = me?.user.role === "TENANT_ADMIN";
  const warning = licenseWarning(d);

  const toggleActive = async () => {
    if (d.active && !(await confirmAction("Archiver ce conducteur ?", `${d.name} ne sera plus proposé pour les véhicules${d.currentVehicle ? ` et quittera ${d.currentVehicle.name}` : ""}. Son historique est conservé.`, "Archiver"))) return;
    setMessage(null);
    try {
      await update.mutateAsync({ id: d.id, body: { active: !d.active } });
    } catch (err) {
      setMessage(formMessage(err));
    }
  };
  const destroy = async () => {
    if (!(await confirmAction("Supprimer ce conducteur ?", `${d.name} sera supprimé définitivement.`, "Supprimer"))) return;
    setMessage(null);
    try {
      await remove(d.id);
      router.replace("/drivers");
    } catch (err) {
      setMessage(formMessage(err));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ScreenHeader title={d.name} subtitle={d.active ? null : "Archivé"} fallback="/drivers" />
      {message ? <Banner message={message} tone="danger" /> : null}
      {warning && d.active ? <Banner message={`Attention : ${warning}.`} tone="danger" /> : null}

      {editing ? (
        <Card title="Modifier le conducteur">
          <DriverForm driver={d} onDone={() => setEditing(false)} />
        </Card>
      ) : (
        <Card title="Coordonnées" right={isAdmin ? <Button label="Modifier" variant="secondary" onPress={() => setEditing(true)} /> : null}>
          <Row label="Téléphone" value={d.phone} />
          <Row label="E-mail" value={d.email} />
          <Row label="N° de permis" value={d.licenseNumber} />
          <Row label="Permis valable jusqu’au" value={d.licenseExpiresOn ? formatDateOnly(d.licenseExpiresOn) : null} />
          <Row label="Notes" value={d.notes} />
          {!d.phone && !d.email && !d.licenseNumber && !d.licenseExpiresOn && !d.notes ? <Text style={styles.muted}>Aucune information complémentaire.</Text> : null}
        </Card>
      )}

      <Card title="Véhicule actuel">
        {d.currentVehicle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${d.currentVehicle.name}. Ouvrir la fiche du véhicule`}
            onPress={() => router.push({ pathname: "/vehicles/[id]", params: { id: d.currentVehicle!.id } })}
            style={({ pressed }) => pressed && { opacity: 0.7 }}
          >
            <Text style={styles.name}>{d.currentVehicle.name}</Text>
            <Text style={styles.muted}>depuis le {formatDateTime(d.currentVehicle.since)}</Text>
          </Pressable>
        ) : (
          <Text style={styles.muted}>Aucun véhicule. Le conducteur s’affecte depuis la fiche d’un véhicule.</Text>
        )}
      </Card>

      <Activity id={d.id} />

      {data.assignments.length > 0 ? (
        <Card title="Historique des véhicules">
          {data.assignments.map((a) => (
            <Text key={a.id} style={styles.muted}>
              {a.vehicle.name} : {span(a)}
            </Text>
          ))}
        </Card>
      ) : null}

      {isAdmin ? (
        <View style={styles.actions}>
          <Button label={d.active ? "Archiver le conducteur" : "Réactiver le conducteur"} variant="secondary" onPress={() => void toggleActive()} />
          {data.assignments.length === 0 ? <Button label="Supprimer le conducteur" variant="danger" onPress={() => void destroy()} /> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 720, alignSelf: "center" },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  alerts: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
  name: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  infoRow: { flexDirection: "row", gap: spacing.md, paddingVertical: 2 },
  infoLabel: { width: 170, fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  infoValue: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  actions: { gap: spacing.sm, borderRadius: radius.lg },
});
