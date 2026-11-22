import { Redirect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ScreenHeader } from "@/components/ScreenHeader";
import { StatTile } from "@/components/StatTile";
import { ErrorState, LoadingState } from "@/components/States";
import { BILLING_STATUS_LABELS, useBilling, type Billing } from "@/lib/admin";
import { userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateOnly } from "@/lib/dates";
import { formatMoney } from "@/lib/rentals";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";

export const BILLING_TONES: Record<Billing["tenants"][number]["billingStatus"], { color: string; soft: string }> = {
  OVERDUE: { color: colors.danger, soft: colors.dangerSoft },
  DUE_SOON: { color: colors.warning, soft: colors.warningSoft },
  OK: { color: colors.online, soft: colors.onlineSoft },
  NONE: { color: colors.offline, soft: colors.border },
};

function delay(t: Billing["tenants"][number]): string {
  if (t.daysLeft == null || !t.paidUntil) return "Aucune échéance saisie";
  if (t.daysLeft < 0) return `Payé jusqu’au ${formatDateOnly(t.paidUntil)} : dépassé de ${-t.daysLeft} jour${t.daysLeft < -1 ? "s" : ""}`;
  return `Payé jusqu’au ${formatDateOnly(t.paidUntil)}${t.daysLeft <= 7 ? ` (dans ${t.daysLeft} jour${t.daysLeft > 1 ? "s" : ""})` : ""}`;
}

/** Abonnements des clients (super-admin) : échéances, quotas, revenu mensuel. */
export function BillingScreen() {
  const { me } = useAuth();
  const router = useRouter();
  useDocumentTitle("Facturation — Administration");
  const { data, isPending, error, refetch } = useBilling();
  if (me && me.user.role !== "SUPER_ADMIN") return <Redirect href="/" />;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenHeader title="Facturation" subtitle="Abonnements des clients" fallback="/admin" />
      {isPending ? (
        <LoadingState />
      ) : !data ? (
        <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />
      ) : (
        <>
          <View style={styles.tiles}>
            <StatTile label="Échéances dépassées" value={String(data.counts.overdue)} />
            <StatTile label="Échéances sous 7 jours" value={String(data.counts.dueSoon)} />
            <StatTile label="Quotas dépassés" value={String(data.counts.overQuota)} />
            {data.monthlyRevenue.map((r) => (
              <StatTile key={r.currency} label={`Revenu mensuel (${r.currency})`} value={formatMoney(r.amount, r.currency)} hint="clients actifs" />
            ))}
          </View>
          <View style={styles.list}>
            {data.tenants.map((t) => {
              const tone = BILLING_TONES[t.billingStatus];
              const details = [
                t.plan,
                t.monthlyFee ? `${formatMoney(t.monthlyFee, t.currency)}/mois` : null,
                `${t.vehicleCount}${t.vehicleQuota != null ? ` / ${t.vehicleQuota}` : ""} véhicule${t.vehicleCount > 1 ? "s" : ""}${t.overQuota ? " (quota dépassé)" : ""}`,
                t.status === "SUSPENDED" ? "suspendu" : null,
              ].filter(Boolean);
              return (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.name}, ${BILLING_STATUS_LABELS[t.billingStatus]}. Ouvrir la fiche`}
                  onPress={() => router.push({ pathname: "/admin/tenants/[id]", params: { id: t.id } })}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={styles.rowHead}>
                    <Text style={styles.name} numberOfLines={1}>
                      {t.name}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: tone.soft }]}>
                      <Text style={[styles.badgeText, { color: tone.color }]}>{BILLING_STATUS_LABELS[t.billingStatus]}</Text>
                    </View>
                  </View>
                  <Text style={styles.muted}>{delay(t)}</Text>
                  <Text style={[styles.muted, t.overQuota && { color: colors.danger }]}>{details.join(" · ")}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 960, alignSelf: "center" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  list: { gap: spacing.sm },
  row: { gap: 2, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.fill },
  rowHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full },
  badgeText: { fontFamily: fonts.heavy, fontSize: 12 },
});
