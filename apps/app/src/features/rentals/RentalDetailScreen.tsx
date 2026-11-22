import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/States";
import { TextField } from "@/components/TextField";
import { ApiError, formMessage, userMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { confirmAction } from "@/lib/confirm";
import { parseLocalDateTime } from "@/lib/dates";
import { formatDateTime, formatKm } from "@/lib/format";
import { formatMoney, fuelLabel, parseAmount, useRental, useRentalActions, type Rental } from "@/lib/rentals";
import { useZones } from "@/lib/zones";
import { colors, fonts, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { HandoverForm } from "./HandoverForm";
import { RentalDocuments } from "./RentalDocuments";
import { RentalPhotos } from "./RentalPhotos";
import { RentalStatusBadge } from "./RentalRow";

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>
        {value}
      </Text>
    </View>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const frenchDate = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const frenchTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Modification d'une location ouverte : fin prévue (prolongation), prix, caution, notes. */
function EditForm({ rental, onDone }: { rental: Rental; onDone: () => void }) {
  const { update } = useRentalActions();
  const [endDate, setEndDate] = useState(frenchDate(rental.endAt));
  const [endTime, setEndTime] = useState(frenchTime(rental.endAt));
  const [price, setPrice] = useState(rental.price?.replace(".", ",") ?? "");
  const [deposit, setDeposit] = useState(rental.deposit?.replace(".", ",") ?? "");
  const [notes, setNotes] = useState(rental.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const endAt = parseLocalDateTime(endDate, endTime);
    if (!endAt) return setError("Saisissez le retour au format JJ/MM/AAAA et HH:MM.");
    const amounts = { price: parseAmount(price), deposit: parseAmount(deposit) };
    if (Number.isNaN(amounts.price) || Number.isNaN(amounts.deposit)) return setError("Saisissez les montants en chiffres (ex. 1200 ou 1200,50).");
    try {
      await update.mutateAsync({ id: rental.id, body: { endAt, price: amounts.price, deposit: amounts.deposit, notes: notes.trim() || null } });
      onDone();
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <View style={styles.form}>
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label="Retour prévu (JJ/MM/AAAA)" value={endDate} onChangeText={setEndDate} keyboardType="numbers-and-punctuation" maxLength={10} />
        </View>
        <View style={styles.time}>
          <TextField label="Heure de retour" value={endTime} onChangeText={setEndTime} keyboardType="numbers-and-punctuation" maxLength={5} />
        </View>
      </View>
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label={`Prix (${rental.currency})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" maxLength={12} />
        </View>
        <View style={styles.flex}>
          <TextField label={`Caution (${rental.currency})`} value={deposit} onChangeText={setDeposit} keyboardType="decimal-pad" maxLength={12} />
        </View>
      </View>
      <TextField label="Notes" value={notes} onChangeText={setNotes} maxLength={2000} multiline />
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label="Enregistrer" onPress={() => void save()} loading={update.isPending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={onDone} disabled={update.isPending} />
        </View>
      </View>
    </View>
  );
}

/** Fiche d'une location : véhicule, locataire, période, montants ; modification et annulation. */
export function RentalDetailScreen({ id }: { id: string }) {
  const { me } = useAuth();
  const branding = useBranding();
  const router = useRouter();
  const { data, isPending, error, refetch } = useRental(id);
  const actions = useRentalActions();
  const [editing, setEditing] = useState(false);
  const [handover, setHandover] = useState<"pickup" | "return" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const zones = useZones().data?.zones;
  useDocumentTitle(`Location — ${branding.name}`);

  if (me && !me.tenant?.rentalsEnabled) return <Redirect href="/" />;
  if (isPending) return <LoadingState />;
  if (!data) {
    if (error instanceof ApiError && error.status === 404) return <EmptyState title="Location introuvable" />;
    return <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />;
  }
  const r = data.rental;
  const canWrite = me?.user.role === "TENANT_ADMIN" || me?.user.role === "AGENT";
  const isAdmin = me?.user.role === "TENANT_ADMIN";
  const open = r.status === "RESERVED" || r.status === "ONGOING";
  const zoneName = r.allowedZoneId ? (zones?.find((z) => z.id === r.allowedZoneId)?.name ?? "Zone définie") : null;

  const cancel = async () => {
    const ok = await confirmAction("Annuler cette réservation ?", `${r.vehicleName} redeviendra libre du ${formatDateTime(r.startAt)} au ${formatDateTime(r.endAt)}.`, "Annuler la réservation");
    if (!ok) return;
    setMessage(null);
    try {
      await actions.cancel(r.id);
    } catch (err) {
      setMessage(formMessage(err));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ScreenHeader title={r.vehicleName} subtitle={r.vehiclePlate} fallback="/rentals" right={<RentalStatusBadge rental={r} />} />
      {message ? <Banner message={message} tone="danger" /> : null}
      {r.late ? <Banner message={`Retour en retard : le véhicule était attendu le ${formatDateTime(r.endAt)}.`} tone="danger" /> : null}

      {canWrite && !editing && !handover && r.status === "RESERVED" && r.vehicleId ? (
        <Button label="Départ du véhicule" onPress={() => setHandover("pickup")} />
      ) : null}
      {canWrite && !editing && !handover && r.status === "ONGOING" ? <Button label="Retour du véhicule" onPress={() => setHandover("return")} /> : null}
      {handover ? (
        <Card title={handover === "pickup" ? "Départ du véhicule" : "Retour du véhicule"}>
          <HandoverForm rental={r} kind={handover} onDone={() => setHandover(null)} />
        </Card>
      ) : null}

      {editing ? (
        <Card title="Modifier la location">
          <EditForm rental={r} onDone={() => setEditing(false)} />
        </Card>
      ) : (
        <Card title="Location" right={canWrite && open ? <Button label="Modifier" variant="secondary" onPress={() => setEditing(true)} /> : null}>
          <Row label="Départ prévu" value={formatDateTime(r.startAt)} />
          <Row label="Retour prévu" value={formatDateTime(r.endAt)} />
          <Row label="Lieu de prise en charge" value={r.pickupLocation} />
          <Row label="Lieu de dépôt" value={r.returnLocation} />
          <Row label="Départ réel" value={r.pickedUpAt ? formatDateTime(r.pickedUpAt) : null} />
          <Row label="Retour réel" value={r.returnedAt ? formatDateTime(r.returnedAt) : null} />
          <Row label="Prix" value={r.price ? formatMoney(r.price, r.currency) : null} />
          <Row label="Caution" value={r.deposit ? formatMoney(r.deposit, r.currency) : null} />
          <Row label="Compteur au départ" value={r.odometerOutKm != null ? formatKm(r.odometerOutKm) : null} />
          <Row label="Carburant au départ" value={r.fuelOut != null ? fuelLabel(r.fuelOut) : null} />
          <Row label="Compteur au retour" value={r.odometerInKm != null ? formatKm(r.odometerInKm) : null} />
          <Row label="Carburant au retour" value={r.fuelIn != null ? fuelLabel(r.fuelIn) : null} />
          <Row
            label="Distance parcourue"
            value={
              r.odometerInKm != null && r.odometerOutKm != null
                ? `${formatKm(r.odometerInKm - r.odometerOutKm)} au compteur${r.gpsDistanceKm != null ? `, ${formatKm(Math.round(r.gpsDistanceKm))} mesurés par GPS` : ""}`
                : null
            }
          />
          <Row label="Zone autorisée" value={zoneName} />
          <Row label="Conducteur" value={r.driverName} />
          <Row label="Notes" value={r.notes} />
        </Card>
      )}

      <Card
        title="Locataire"
        right={
          canWrite ? (
            <Button label="Voir la fiche" variant="secondary" onPress={() => router.push({ pathname: "/customers/[id]", params: { id: r.customerId } })} />
          ) : null
        }
      >
        <Row label="Nom" value={r.customerName} />
        <Row label="Téléphone" value={r.customerPhone} />
      </Card>

      <RentalDocuments rental={r} />
      <RentalPhotos rentalId={r.id} phase="PICKUP" canAdd={canWrite && open} canDelete={isAdmin} />
      {r.status === "ONGOING" || r.status === "COMPLETED" ? (
        <RentalPhotos rentalId={r.id} phase="RETURN" canAdd={canWrite} canDelete={isAdmin} />
      ) : null}

      {r.vehicleId ? (
        <Button label="Voir le véhicule sur la carte" variant="secondary" onPress={() => router.push({ pathname: "/vehicles/[id]", params: { id: r.vehicleId! } })} />
      ) : (
        <Text style={styles.muted}>Ce véhicule n’est plus rattaché à votre compte.</Text>
      )}
      {canWrite && r.status === "RESERVED" && !editing ? <Button label="Annuler la réservation" variant="danger" onPress={() => void cancel()} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 640, alignSelf: "center" },
  form: { gap: spacing.md },
  pair: { flexDirection: "row", gap: spacing.sm },
  time: { width: 130 },
  row: { gap: 2 },
  label: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  value: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
