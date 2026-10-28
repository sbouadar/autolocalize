import { StyleSheet, Text, View } from "react-native";
import { AUDIT_LABELS, type AuditEntry } from "@/lib/admin";
import { formatDateTime } from "@/lib/format";
import { colors, spacing } from "@/lib/theme";

/** Résumé lisible des détails d'une action (champs simples uniquement). */
export function describeDetails(details: unknown): string {
  if (!details || typeof details !== "object") return "";
  return Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v))
    .map(([k, v]) => `${k} : ${v === null ? "—" : String(v)}`)
    .join(" · ");
}

export function AuditList({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <Text style={styles.muted}>Aucune action enregistrée.</Text>;
  return (
    <View style={styles.list}>
      {entries.map((e) => (
        <View key={e.id} style={styles.row}>
          <Text style={styles.action}>{AUDIT_LABELS[e.action] ?? e.action}</Text>
          <Text style={styles.muted}>
            {formatDateTime(e.createdAt)} · {e.actorEmail}
          </Text>
          {describeDetails(e.details) ? (
            <Text style={styles.details} numberOfLines={3}>
              {describeDetails(e.details)}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: { gap: 2, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  action: { fontSize: 15, fontWeight: "600", color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  details: { fontSize: 12, color: colors.muted },
});
