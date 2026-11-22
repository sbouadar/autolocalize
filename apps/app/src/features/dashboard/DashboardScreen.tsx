import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SegmentedControl } from "@/components/SegmentedControl";
import { StatTile } from "@/components/StatTile";
import { Banner, ErrorState, LoadingState } from "@/components/States";
import { userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { useKpis } from "@/lib/dashboard";
import { formatDistance, formatDuration, formatSpeed } from "@/lib/format";
import { DASHBOARD_PERIODS, type PeriodKey } from "@/lib/period";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import type { Kpis } from "@/lib/types";
import { useDocumentTitle } from "@/lib/use-document-title";
import { vehicleLabel } from "@/lib/vehicles";
import { FleetWatch } from "./FleetWatch";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Ranking({ vehicles }: { vehicles: Kpis["vehicles"] }) {
  const router = useRouter();
  const branding = useBranding();
  const max = Math.max(...vehicles.map((v) => v.distanceKm), 0);
  return (
    <View style={styles.ranking}>
      {vehicles.map((v) => (
        <Pressable
          key={v.id}
          accessibilityRole="button"
          accessibilityLabel={`${vehicleLabel(v)} : ${formatDistance(v.distanceKm)}, ${v.trips} trajets. Ouvrir la fiche`}
          onPress={() => router.push({ pathname: "/vehicles/[id]", params: { id: v.id } })}
          style={({ pressed }) => [styles.rankRow, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.rankHead}>
            <Text style={styles.rankName} numberOfLines={1}>
              {vehicleLabel(v)}
            </Text>
            <Text style={styles.rankValue}>{formatDistance(v.distanceKm)}</Text>
          </View>
          <View style={styles.bar}>
            <View
              style={[
                styles.barFill,
                { backgroundColor: branding.primaryColor, width: `${max > 0 ? (v.distanceKm / max) * 100 : 0}%` },
              ]}
            />
          </View>
          <Text style={styles.muted}>
            {v.trips} trajet{v.trips > 1 ? "s" : ""} · {formatDuration(v.drivingMs)} de conduite
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Accueil : état de la flotte et activité de la période choisie. */
export function DashboardScreen() {
  const { me } = useAuth();
  const branding = useBranding();
  const router = useRouter();
  useDocumentTitle(`Tableau de bord — ${branding.name}`);
  const [periodKey, setPeriodKey] = useState<PeriodKey>("today");
  const { data, isPending, error, refetch } = useKpis(periodKey);

  const greeting = (
    <View>
      <Text style={styles.hello}>Bonjour {me?.user.name}</Text>
      <Text style={styles.muted}>{branding.name}</Text>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {greeting}
      <FleetWatch />
      {me?.user.role === "TENANT_ADMIN" || me?.user.role === "VIEWER" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dépenses et rentabilité"
          onPress={() => router.push("/profitability")}
          style={({ pressed }) => [styles.link, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.linkTitle}>Dépenses et rentabilité</Text>
          <Text style={styles.muted}>{me.tenant?.rentalsEnabled ? "Recettes, dépenses et marge par véhicule" : "Dépenses et coût au kilomètre par véhicule"}</Text>
        </Pressable>
      ) : null}
      {me?.user.role === "TENANT_ADMIN" || me?.user.role === "VIEWER" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Rapports et exports"
          onPress={() => router.push("/exports")}
          style={({ pressed }) => [styles.link, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.linkTitle}>Rapports et exports</Text>
          <Text style={styles.muted}>Trajets, dépenses, entretiens{me.tenant?.rentalsEnabled ? ", locations" : ""} en fichier Excel (CSV)</Text>
        </Pressable>
      ) : null}
      <SegmentedControl options={DASHBOARD_PERIODS} value={periodKey} onChange={setPeriodKey} />

      {isPending ? (
        <LoadingState label="Calcul des indicateurs…" />
      ) : !data ? (
        <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />
      ) : (
        <>
          {error ? <Banner message="Connexion perdue : les indicateurs ne sont plus actualisés." /> : null}
          {!data.liveDataAvailable ? (
            <Banner message="Suivi en direct momentanément indisponible : l’état de la flotte est incomplet." />
          ) : null}

          <Section title="Flotte en ce moment">
            <View style={styles.tiles}>
              <StatTile label="Véhicules" value={String(data.fleet.total)} />
              <StatTile label="En ligne" value={String(data.fleet.online)} />
              <StatTile label="En mouvement" value={String(data.fleet.moving)} />
              <StatTile label="Hors ligne" value={String(data.fleet.offline + data.fleet.unknown)} />
            </View>
          </Section>

          <Section title="Activité de la période">
            {data.totals ? (
              <View style={styles.tiles}>
                <StatTile label="Distance" value={formatDistance(data.totals.distanceKm)} />
                <StatTile label="Temps de conduite" value={formatDuration(data.totals.drivingMs)} />
                <StatTile label="Trajets" value={String(data.totals.trips)} />
                <StatTile label="Vitesse max" value={formatSpeed(data.totals.maxSpeedKmh)} />
                <StatTile
                  label="Heures moteur"
                  value={formatDuration(data.totals.engineHoursMs)}
                  hint="selon les traceurs compatibles"
                />
              </View>
            ) : (
              <Banner message="Les rapports d’activité sont momentanément indisponibles." />
            )}
          </Section>

          {data.vehicles.length > 0 ? (
            <Section title="Véhicules les plus actifs">
              <Ranking vehicles={data.vehicles} />
            </Section>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, width: "100%", maxWidth: 960, alignSelf: "center" },
  link: { gap: 2, padding: spacing.lg, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.fill },
  linkTitle: { fontFamily: fonts.heavy, fontSize: 16, color: colors.text },
  hello: { fontSize: 22, fontFamily: fonts.heavy, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 17, fontFamily: fonts.heavy, color: colors.text },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  ranking: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  rankRow: { gap: spacing.xs },
  rankHead: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  rankName: { flex: 1, fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  rankValue: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
});
