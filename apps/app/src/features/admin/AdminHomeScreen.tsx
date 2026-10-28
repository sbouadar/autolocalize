import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { TENANT_STATUS_LABELS, useTenants, type TenantStatus } from "@/lib/admin";
import { userMessage } from "@/lib/api";
import { colors, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { matchesQuery } from "@/lib/vehicle-filters";

export const STATUS_COLORS: Record<TenantStatus, { fg: string; bg: string }> = {
  ACTIVE: { fg: colors.online, bg: "#F0FDF4" },
  SUSPENDED: { fg: colors.warning, bg: colors.warningSoft },
  CANCELLED: { fg: colors.danger, bg: colors.dangerSoft },
};

export function StatusBadge({ status }: { status: TenantStatus }) {
  const c = STATUS_COLORS[status];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{TENANT_STATUS_LABELS[status]}</Text>
    </View>
  );
}

/** Accueil du back-office : liste des clients. */
export function AdminHomeScreen() {
  useDocumentTitle("Administration — AutoLocalize");
  const router = useRouter();
  const { data, isPending, error, refetch } = useTenants();
  const [query, setQuery] = useState("");
  const tenants = useMemo(
    () => (data?.tenants ?? []).filter((t) => matchesQuery({ name: t.name, plate: t.slug }, query)),
    [data, query],
  );

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Administration
        </Text>
        <View style={styles.actions}>
          <Button label="Journal" variant="secondary" onPress={() => router.push("/admin/audit")} />
          <Button label="Nouveau client" onPress={() => router.push("/admin/tenants/new")} />
        </View>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Rechercher un client"
        placeholderTextColor={colors.muted}
        accessibilityLabel="Rechercher un client"
        autoCapitalize="none"
        style={styles.search}
      />

      {isPending ? (
        <LoadingState />
      ) : !data ? (
        <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />
      ) : tenants.length === 0 ? (
        <EmptyState title={query ? "Aucun client ne correspond" : "Aucun client"} />
      ) : (
        <View style={styles.list}>
          {tenants.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={`${t.name}, ${TENANT_STATUS_LABELS[t.status]}, ${t.vehicleCount} véhicules`}
              onPress={() => router.push({ pathname: "/admin/tenants/[id]", params: { id: t.id } })}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.dot, { backgroundColor: t.primaryColor }]} />
              <View style={styles.main}>
                <Text style={styles.name} numberOfLines={1}>
                  {t.name}
                </Text>
                <Text style={styles.muted}>
                  /login/{t.slug} · {t.vehicleCount} véhicule{t.vehicleCount > 1 ? "s" : ""}
                </Text>
              </View>
              <StatusBadge status={t.status} />
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 960, alignSelf: "center" },
  head: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  actions: { flexDirection: "row", gap: spacing.sm },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  main: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  badge: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: "700" },
});
