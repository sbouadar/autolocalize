import { Redirect } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { DateField } from "@/components/DateField";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SelectField } from "@/components/SelectField";
import { Banner } from "@/components/States";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { isoDay, todayIso } from "@/lib/dates";
import { openPrivateCsv } from "@/lib/private-pdf";
import { colors, fonts, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useVehicles, vehicleLabel } from "@/lib/vehicles";

type Kind = "trips" | "rentals" | "expenses" | "maintenance";
const ALL = "__all__";
const TRIPS_MAX_DAYS = 31;
const OTHER_MAX_DAYS = 366;

const KINDS: { kind: Kind; label: string; file: string; hint: string }[] = [
  { kind: "trips", label: "Trajets", file: "trajets", hint: "Départ, arrivée, durée, distance, vitesses (31 jours au plus)." },
  { kind: "rentals", label: "Locations", file: "locations", hint: "Locataire, dates, lieux, compteurs, prix (sans pièce d’identité)." },
  { kind: "expenses", label: "Dépenses", file: "depenses", hint: "Date, véhicule, catégorie, montant, litres." },
  { kind: "maintenance", label: "Entretiens", file: "entretiens", hint: "Entretiens réalisés, compteur, garage, coût." },
];

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Exports CSV (Excel) des trajets, locations, dépenses et entretiens sur une période. */
export function ExportsScreen() {
  const { me } = useAuth();
  const branding = useBranding();
  useDocumentTitle(`Rapports et exports — ${branding.name}`);
  const vehicles = useVehicles().data?.vehicles ?? [];
  const [from, setFrom] = useState<string | null>(() => {
    const now = new Date();
    return isoDay(now.getFullYear(), now.getMonth(), 1);
  });
  const [to, setTo] = useState<string | null>(() => todayIso());
  const [vehicleId, setVehicleId] = useState<string | null>(ALL);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const role = me?.user.role;
  if (me && role !== "TENANT_ADMIN" && role !== "VIEWER") return <Redirect href="/" />;

  const kinds = KINDS.filter((k) => k.kind !== "rentals" || me?.tenant?.rentalsEnabled);
  const span = from && to ? daysBetween(from, to) : null;

  const download = async (kind: Kind, file: string) => {
    setError(null);
    if (!from || !to || span == null) return setError("Choisissez les dates de début et de fin.");
    if (span < 0) return setError("La date de fin doit être après la date de début.");
    const max = kind === "trips" ? TRIPS_MAX_DAYS : OTHER_MAX_DAYS;
    if (span >= max) return setError(kind === "trips" ? "Les trajets s’exportent sur 31 jours au plus." : "Une année au plus par export.");
    const query = new URLSearchParams({ from, to, ...(vehicleId && vehicleId !== ALL && { vehicleId }) });
    setBusy(kind);
    try {
      await openPrivateCsv(`/exports/${kind}.csv?${query.toString()}`, `${file}-${from}-${to}.csv`);
    } catch {
      setError("L’export n’a pas pu être téléchargé. Vérifiez la connexion et réessayez.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <ScreenHeader title="Rapports et exports" subtitle="Fichiers CSV à ouvrir dans Excel" fallback="/" />
      <Card title="Période et véhicule">
        <View style={styles.pair}>
          <View style={styles.flex}>
            <DateField label="Du" value={from} onChange={setFrom} />
          </View>
          <View style={styles.flex}>
            <DateField label="Au" value={to} onChange={setTo} min={from} openOn={from} />
          </View>
        </View>
        <SelectField
          label="Véhicule"
          options={[{ key: ALL, label: "Tous les véhicules" }, ...vehicles.map((v) => ({ key: v.id, label: vehicleLabel(v) }))]}
          value={vehicleId}
          onChange={setVehicleId}
        />
      </Card>
      {error ? <Banner message={error} tone="danger" /> : null}
      {kinds.map((k) => (
        <Card key={k.kind} title={k.label} right={<Button label="Télécharger" variant="secondary" onPress={() => void download(k.kind, k.file)} loading={busy === k.kind} />}>
          <Text style={styles.muted}>{k.hint}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 720, alignSelf: "center" },
  flex: { flex: 1 },
  pair: { flexDirection: "row", gap: spacing.sm },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
