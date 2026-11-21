import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState } from "@/components/States";
import { TextField } from "@/components/TextField";
import { userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { useCustomers } from "@/lib/rentals";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { CustomerForm } from "./CustomerForm";

/** Délai avant de lancer la recherche pendant la frappe. */
const SEARCH_DELAY_MS = 300;

/** Locataires du client : recherche par nom, téléphone ou numéro de pièce exact ; création. */
export function CustomersScreen() {
  const { me } = useAuth();
  const branding = useBranding();
  const router = useRouter();
  useDocumentTitle(`Locataires — ${branding.name}`);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [input]);
  const { data, isPending, error, refetch } = useCustomers(query);

  const role = me?.user.role;
  if (me && (!me.tenant?.rentalsEnabled || (role !== "TENANT_ADMIN" && role !== "AGENT"))) return <Redirect href="/" />;
  const open = (id: string) => router.push({ pathname: "/customers/[id]", params: { id } });

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ScreenHeader title="Locataires" fallback="/rentals" />
      {creating ? (
        <Card title="Nouveau locataire">
          <CustomerForm
            onSaved={(c) => {
              setCreating(false);
              open(c.id);
            }}
            onCancel={() => setCreating(false)}
          />
        </Card>
      ) : (
        <Button label="Nouveau locataire" onPress={() => setCreating(true)} />
      )}

      <TextField
        label="Rechercher"
        value={input}
        onChangeText={setInput}
        placeholder="Nom, téléphone ou n° de pièce complet"
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
      />

      {isPending ? (
        <Text style={styles.muted}>Chargement…</Text>
      ) : !data ? (
        <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />
      ) : data.customers.length === 0 ? (
        <Text style={styles.muted}>{query ? "Aucun locataire ne correspond à cette recherche." : "Aucun locataire enregistré."}</Text>
      ) : (
        <View style={styles.list}>
          {data.customers.map((c) => (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={`${c.name}. Ouvrir la fiche`}
              onPress={() => open(c.id)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.name, c.anonymized && styles.anonymized]} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {[c.phone, c.idDocumentMasked].filter(Boolean).join(" · ") || (c.kind === "COMPANY" ? "Société" : "Particulier")}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 640, alignSelf: "center" },
  list: { gap: spacing.sm },
  row: { minHeight: 60, justifyContent: "center", gap: 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.fill },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  anonymized: { color: colors.muted },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
