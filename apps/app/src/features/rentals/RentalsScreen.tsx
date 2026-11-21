import { Redirect, useRouter } from "expo-router";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Button } from "@/components/Button";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { groupRentals, useRentals, type Rental } from "@/lib/rentals";
import { colors, fonts, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useVehicles } from "@/lib/vehicles";
import { RentalPlanning } from "./RentalPlanning";
import { RentalRow } from "./RentalRow";

/** Largeur à partir de laquelle le planning sur deux semaines s'affiche. */
const PLANNING_BREAKPOINT = 900;

function Section({ title, rentals, onOpen }: { title: string; rentals: Rental[]; onOpen: (id: string) => void }) {
  if (rentals.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title} ({rentals.length})
      </Text>
      {rentals.map((r) => (
        <RentalRow key={r.id} rental={r} onPress={() => onOpen(r.id)} />
      ))}
    </View>
  );
}

/** Onglet « Locations » : en cours, à venir, passées ; planning sur grand écran. */
export function RentalsScreen() {
  const { me } = useAuth();
  const branding = useBranding();
  const router = useRouter();
  useDocumentTitle(`Locations — ${branding.name}`);
  const enabled = me?.tenant?.rentalsEnabled === true;
  const { data, isPending, error, refetch } = useRentals();
  const vehicles = useVehicles().data?.vehicles;
  const wide = useWindowDimensions().width >= PLANNING_BREAKPOINT;
  const groups = useMemo(() => groupRentals(data?.rentals ?? []), [data]);
  // Planning à partir d'aujourd'hui minuit (heure locale), recalculé à chaque chargement des locations.
  const planningStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (me && !enabled) return <Redirect href="/" />;
  if (isPending) return <LoadingState label="Chargement des locations…" />;
  if (!data) return <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />;

  const canWrite = me?.user.role === "TENANT_ADMIN" || me?.user.role === "AGENT";
  const open = (id: string) => router.push({ pathname: "/rentals/[id]", params: { id } });

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {canWrite ? (
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button label="Nouvelle réservation" onPress={() => router.push("/rentals/new")} />
          </View>
          <View style={styles.flex}>
            <Button label="Locataires" variant="secondary" onPress={() => router.push("/customers")} />
          </View>
        </View>
      ) : null}

      {wide && vehicles && vehicles.length > 0 ? (
        <RentalPlanning vehicles={vehicles} rentals={data.rentals} start={planningStart} onOpen={open} />
      ) : null}

      {data.rentals.length === 0 ? (
        <EmptyState
          title="Aucune location"
          message={canWrite ? "Créez une réservation : choisissez la période, un véhicule libre, puis le locataire." : "Aucune location pour le moment."}
        />
      ) : (
        <>
          <Section title="En cours" rentals={groups.ongoing} onOpen={open} />
          <Section title="À venir" rentals={groups.upcoming} onOpen={open} />
          <Section title="Terminées et annulées" rentals={groups.past} onOpen={open} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: spacing.lg, gap: spacing.lg, width: "100%", maxWidth: 1100, alignSelf: "center" },
  actions: { flexDirection: "row", gap: spacing.sm },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 18, fontFamily: fonts.heavy, letterSpacing: -0.3, color: colors.text },
});
