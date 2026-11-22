import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, LoadingState } from "@/components/States";
import { userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { formatDateOnly, todayIso } from "@/lib/dates";
import { useDrivers, type Driver } from "@/lib/drivers";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { DriverForm } from "./DriverForm";

/** Permis expiré ou expirant dans 30 jours : signalé dans la liste. */
export function licenseWarning(d: Pick<Driver, "licenseExpiresOn">, today = todayIso()): string | null {
  if (!d.licenseExpiresOn) return null;
  const days = Math.round((Date.parse(`${d.licenseExpiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return `permis expiré le ${formatDateOnly(d.licenseExpiresOn)}`;
  if (days <= 30) return `permis valable jusqu’au ${formatDateOnly(d.licenseExpiresOn)}`;
  return null;
}

/** Liste des conducteurs du client (module conducteurs) ; création par l'admin. */
export function DriversScreen() {
  const { me } = useAuth();
  const branding = useBranding();
  const router = useRouter();
  useDocumentTitle(`Conducteurs — ${branding.name}`);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const { data, isPending, error, refetch } = useDrivers(showArchived);

  if (me && !me.tenant?.driversEnabled) return <Redirect href="/" />;
  const isAdmin = me?.user.role === "TENANT_ADMIN";
  const open = (id: string) => router.push({ pathname: "/drivers/[id]", params: { id } });

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ScreenHeader title="Conducteurs" fallback="/profile" right={isAdmin && !adding ? <Button label="Ajouter" variant="secondary" onPress={() => setAdding(true)} /> : null} />
      {adding ? (
        <Card title="Nouveau conducteur">
          <DriverForm
            onDone={(saved) => {
              setAdding(false);
              if (saved) open(saved.id);
            }}
          />
        </Card>
      ) : null}
      {isPending ? (
        <LoadingState />
      ) : !data ? (
        <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />
      ) : data.drivers.length === 0 ? (
        <Text style={styles.muted}>{isAdmin ? "Aucun conducteur : ajoutez vos chauffeurs pour leur affecter des véhicules." : "Aucun conducteur."}</Text>
      ) : (
        <View style={styles.list}>
          {data.drivers.map((d) => {
            const warning = licenseWarning(d);
            const line = [d.currentVehicle ? `conduit ${d.currentVehicle.name}` : "sans véhicule", d.phone, warning].filter(Boolean).join(" · ");
            return (
              <Pressable
                key={d.id}
                accessibilityRole="button"
                accessibilityLabel={`${d.name}${d.active ? "" : " (archivé)"}, ${line}. Ouvrir la fiche`}
                onPress={() => open(d.id)}
                style={({ pressed }) => [styles.row, !d.active && { opacity: 0.6 }, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.name}>
                  {d.name}
                  {d.active ? "" : " · archivé"}
                </Text>
                <Text style={[styles.muted, warning && d.active ? { color: colors.danger } : null]}>{line}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={() => setShowArchived((v) => !v)} style={styles.toggle} hitSlop={8}>
        <Text style={styles.toggleText}>{showArchived ? "Masquer les conducteurs archivés" : "Afficher les conducteurs archivés"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 720, alignSelf: "center" },
  list: { gap: spacing.sm },
  row: { gap: 2, minHeight: 56, justifyContent: "center", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.fill },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  toggle: { alignSelf: "flex-start", minHeight: 40, justifyContent: "center" },
  toggleText: { fontFamily: fonts.bold, fontSize: 13, color: colors.text },
});
