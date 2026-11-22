import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SegmentedControl } from "@/components/SegmentedControl";
import { StatTile } from "@/components/StatTile";
import { Banner, ErrorState, LoadingState } from "@/components/States";
import { userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { formatDateOnly } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS, PROFIT_PERIODS, profitPeriod, useProfitability, type Profitability, type ProfitPeriodKey } from "@/lib/expenses";
import { formatDistance } from "@/lib/format";
import { formatMoney } from "@/lib/rentals";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";

const perKm = (amount: string | null, currency: Profitability["currency"]) => (amount ? `${formatMoney(amount, currency)}/km` : "—");

function VehicleRow({ v, data }: { v: Profitability["vehicles"][number]; data: Profitability }) {
  const router = useRouter();
  const negative = Number(v.margin) < 0;
  const details = [
    data.rentalsEnabled ? `${v.rentalCount} location${v.rentalCount > 1 ? "s" : ""}` : null,
    data.rentalsEnabled ? `recettes ${formatMoney(v.revenue, data.currency)}` : null,
    `dépenses ${formatMoney(v.expenses, data.currency)}`,
    v.distanceKm != null ? formatDistance(v.distanceKm) : null,
    v.costPerKm ? perKm(v.costPerKm, data.currency) : null,
    v.consumptionL100 != null ? `${String(v.consumptionL100).replace(".", ",")} L/100 km` : null,
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${v.name} : ${data.rentalsEnabled ? `marge ${formatMoney(v.margin, data.currency)}` : `dépenses ${formatMoney(v.expenses, data.currency)}`}. Ouvrir la fiche`}
      onPress={() => router.push({ pathname: "/vehicles/[id]", params: { id: v.vehicleId } })}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.rowHead}>
        <Text style={styles.name} numberOfLines={1}>
          {v.name}
          {v.plate && v.plate !== v.name ? <Text style={styles.muted}> · {v.plate}</Text> : null}
        </Text>
        <Text style={[styles.value, data.rentalsEnabled && negative && { color: colors.danger }]}>
          {formatMoney(data.rentalsEnabled ? v.margin : v.expenses, data.currency)}
        </Text>
      </View>
      <Text style={styles.muted}>{details.join(" · ")}</Text>
    </Pressable>
  );
}

/** Dépenses et rentabilité de la flotte sur une période : totaux, répartition, détail par véhicule. */
export function ProfitabilityScreen() {
  const { me } = useAuth();
  const branding = useBranding();
  useDocumentTitle(`Dépenses et rentabilité — ${branding.name}`);
  const [periodKey, setPeriodKey] = useState<ProfitPeriodKey>("month");
  const period = profitPeriod(periodKey);
  const { data, isPending, error, refetch } = useProfitability(period.from, period.to);

  const role = me?.user.role;
  if (me && role !== "TENANT_ADMIN" && role !== "VIEWER") return <Redirect href="/" />;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenHeader title="Dépenses et rentabilité" subtitle={`Du ${formatDateOnly(period.from)} au ${formatDateOnly(period.to)}`} fallback="/" />
      <SegmentedControl options={PROFIT_PERIODS} value={periodKey} onChange={setPeriodKey} />
      {isPending ? (
        <LoadingState label="Calcul de la rentabilité…" />
      ) : !data ? (
        <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />
      ) : (
        <>
          {!data.distanceAvailable ? <Banner message="Suivi GPS momentanément indisponible : distances et coût au kilomètre non calculés." /> : null}
          <View style={styles.tiles}>
            {data.rentalsEnabled ? <StatTile label="Recettes" value={formatMoney(data.totals.revenue, data.currency)} hint="locations terminées" /> : null}
            <StatTile label="Dépenses" value={formatMoney(data.totals.expenses, data.currency)} />
            {data.rentalsEnabled ? <StatTile label="Marge" value={formatMoney(data.totals.margin, data.currency)} /> : null}
            <StatTile label="Distance" value={data.totals.distanceKm != null ? formatDistance(data.totals.distanceKm) : "—"} />
            <StatTile label="Coût au km" value={perKm(data.totals.costPerKm, data.currency)} />
          </View>

          <Text style={styles.section}>Répartition des dépenses</Text>
          {data.byCategory.length === 0 ? (
            <Text style={styles.muted}>Aucune dépense sur cette période. Elles se saisissent depuis la fiche de chaque véhicule.</Text>
          ) : (
            <View style={styles.box}>
              {data.byCategory.map((c) => {
                const share = Number(data.totals.expenses) > 0 ? (Number(c.amount) / Number(data.totals.expenses)) * 100 : 0;
                return (
                  <View key={c.category} style={styles.catRow} accessible accessibilityLabel={`${EXPENSE_CATEGORY_LABELS[c.category]} : ${formatMoney(c.amount, data.currency)}`}>
                    <View style={styles.rowHead}>
                      <Text style={styles.catName}>{EXPENSE_CATEGORY_LABELS[c.category]}</Text>
                      <Text style={styles.catValue}>{formatMoney(c.amount, data.currency)}</Text>
                    </View>
                    <View style={styles.bar}>
                      <View style={[styles.barFill, { width: `${share}%`, backgroundColor: branding.primaryColor }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          <Text style={styles.section}>Par véhicule</Text>
          <Text style={styles.muted}>
            {data.rentalsEnabled ? "Du plus rentable au moins rentable. Recettes : locations dont le retour tombe dans la période." : "Dépenses de la période par véhicule."}
          </Text>
          <View style={styles.list}>
            {data.vehicles.map((v) => (
              <VehicleRow key={v.vehicleId} v={v} data={data} />
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 900, alignSelf: "center" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  section: { fontSize: 18, fontFamily: fonts.heavy, letterSpacing: -0.3, color: colors.text, marginTop: spacing.md },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  box: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.fill },
  catRow: { gap: spacing.xs },
  catName: { flex: 1, fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  catValue: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, fontVariant: ["tabular-nums"] },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  list: { gap: spacing.sm },
  row: { gap: 2, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.fill },
  rowHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  value: { fontFamily: fonts.heavy, fontSize: 15, color: colors.text, fontVariant: ["tabular-nums"] },
});
