import { ScrollView, StyleSheet, Text } from "react-native";
import { Card } from "@/components/Card";
import { ErrorState, LoadingState } from "@/components/States";
import { useAudit } from "@/lib/admin";
import { userMessage } from "@/lib/api";
import { colors, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { AuditList } from "./AuditList";

/** Journal des actions du back-office (100 dernières). */
export function AuditScreen() {
  useDocumentTitle("Journal — AutoLocalize");
  const { data, isPending, error, refetch } = useAudit();
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title} accessibilityRole="header">
        Journal d’administration
      </Text>
      {isPending ? (
        <LoadingState />
      ) : !data ? (
        <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />
      ) : (
        <Card title={`${data.entries.length} dernières actions`}>
          <AuditList entries={data.entries} />
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, width: "100%", maxWidth: 960, alignSelf: "center" },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
});
