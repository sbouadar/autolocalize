import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChoiceChips } from "@/components/ChoiceChips";
import { DateField } from "@/components/DateField";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SelectField } from "@/components/SelectField";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { localDateTime, TIME_OPTIONS, todayIso } from "@/lib/dates";
import { formatDateTime } from "@/lib/format";
import { parseAmount, RENTAL_LOCATIONS, unavailableLabel, useAvailability, useCustomers, useRentalActions, type Customer } from "@/lib/rentals";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useZones } from "@/lib/zones";
import { CustomerForm } from "./CustomerForm";

const SEARCH_DELAY_MS = 300;
const OTHER = "__other__";
const LOCATION_OPTIONS = [...RENTAL_LOCATIONS.map((l) => ({ key: l as string, label: l as string })), { key: OTHER, label: "Autre (saisie libre)" }];

/** Lieu de prise en charge ou de dépôt : une agence de la liste, ou « Autre » pour le saisir. */
function LocationField({ label, choice, onChoice, other, onOther }: { label: string; choice: string | null; onChoice: (c: string) => void; other: string; onOther: (t: string) => void }) {
  return (
    <>
      <SelectField label={label} options={LOCATION_OPTIONS} value={choice} onChange={onChoice} placeholder="Choisir une agence" />
      {choice === OTHER ? <TextField label={`${label} : précisez`} value={other} onChangeText={onOther} maxLength={191} placeholder="Adresse, hôtel, gare…" /> : null}
    </>
  );
}

/** Choix du locataire : recherche parmi les locataires existants, ou création. */
function CustomerPicker({ selected, onSelect }: { selected: Customer | null; onSelect: (c: Customer | null) => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [input]);
  const { data } = useCustomers(query);

  if (selected) {
    return (
      <View style={styles.chosen}>
        <View style={styles.flex}>
          <Text style={styles.name}>{selected.name}</Text>
          <Text style={styles.muted}>{[selected.phone, selected.idDocumentMasked].filter(Boolean).join(" · ") || "Aucune coordonnée"}</Text>
        </View>
        <Button label="Changer" variant="secondary" onPress={() => onSelect(null)} />
      </View>
    );
  }
  if (creating) return <CustomerForm onSaved={onSelect} onCancel={() => setCreating(false)} />;

  const customers = (data?.customers ?? []).filter((c) => !c.anonymized).slice(0, 8);
  return (
    <View style={styles.gap}>
      <TextField
        label="Rechercher un locataire"
        value={input}
        onChangeText={setInput}
        placeholder="Nom, téléphone ou n° de pièce complet"
        autoCorrect={false}
        autoCapitalize="none"
      />
      {customers.map((c) => (
        <Pressable
          key={c.id}
          accessibilityRole="button"
          accessibilityLabel={`Choisir ${c.name}`}
          onPress={() => onSelect(c)}
          style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.name}>{c.name}</Text>
          <Text style={styles.muted}>{[c.phone, c.idDocumentMasked].filter(Boolean).join(" · ") || " "}</Text>
        </Pressable>
      ))}
      {data && customers.length === 0 ? <Text style={styles.muted}>Aucun locataire trouvé.</Text> : null}
      <Button label="Nouveau locataire" variant="secondary" onPress={() => setCreating(true)} />
    </View>
  );
}

/** Nouvelle réservation : la période, puis un véhicule libre, puis le locataire et le prix. */
export function NewRentalScreen() {
  const { me } = useAuth();
  const branding = useBranding();
  const router = useRouter();
  useDocumentTitle(`Nouvelle réservation — ${branding.name}`);
  const { create } = useRentalActions();
  // Le départ est préréglé sur aujourd'hui, mais une date passée reste possible (ancienne réservation à reprendre).
  const [fromDay, setFromDay] = useState<string | null>(todayIso());
  const [fromTime, setFromTime] = useState("09:00");
  const [toDay, setToDay] = useState<string | null>(null);
  const [toTime, setToTime] = useState("09:00");
  const [pickupChoice, setPickupChoice] = useState<string | null>(null);
  const [pickupOther, setPickupOther] = useState("");
  const [returnChoice, setReturnChoice] = useState<string | null>(null);
  const [returnOther, setReturnOther] = useState("");
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [price, setPrice] = useState("");
  const [deposit, setDeposit] = useState("");
  const [notes, setNotes] = useState("");
  // Zone que le véhicule ne doit pas quitter pendant la location (facultatif) : alerte à la sortie.
  const [zoneId, setZoneId] = useState("none");
  const zones = useZones().data?.zones ?? [];
  const [error, setError] = useState<string | null>(null);
  const availability = useAvailability(period?.from ?? null, period?.to ?? null);

  const role = me?.user.role;
  if (me && (!me.tenant?.rentalsEnabled || (role !== "TENANT_ADMIN" && role !== "AGENT"))) return <Redirect href="/" />;
  const currency = me?.tenant?.currency ?? "MAD";

  const choosePeriod = () => {
    setError(null);
    if (!fromDay || !toDay) return setError("Choisissez la date de départ et la date de retour.");
    const from = localDateTime(fromDay, fromTime);
    const to = localDateTime(toDay, toTime);
    if (to <= from) return setError("Le retour doit être après le départ.");
    setVehicleId(null);
    setPeriod({ from, to });
  };

  const submit = async () => {
    setError(null);
    if (!period || !vehicleId || !customer) return;
    const amounts = { price: parseAmount(price), deposit: parseAmount(deposit) };
    if (Number.isNaN(amounts.price) || Number.isNaN(amounts.deposit)) return setError("Saisissez les montants en chiffres (ex. 1200 ou 1200,50).");
    try {
      const result = await create.mutateAsync({
        vehicleId,
        customerId: customer.id,
        startAt: period.from,
        endAt: period.to,
        price: amounts.price,
        deposit: amounts.deposit,
        notes: notes.trim() || null,
        pickupLocation: (pickupChoice === OTHER ? pickupOther.trim() : pickupChoice) || null,
        returnLocation: (returnChoice === OTHER ? returnOther.trim() : returnChoice) || null,
        ...(zoneId !== "none" && { allowedZoneId: zoneId }),
      });
      router.replace({ pathname: "/rentals/[id]", params: { id: result.rental.id } });
    } catch (err) {
      setError(formMessage(err));
      // Véhicule pris entre-temps : la liste des véhicules libres est à relire.
      void availability.refetch();
    }
  };

  const vehicles = availability.data?.vehicles ?? [];

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <ScreenHeader title="Nouvelle réservation" fallback="/rentals" />

      <Card title="1. Période et lieux">
        <View style={styles.pair}>
          <View style={styles.flex}>
            <DateField label="Date de départ" value={fromDay} onChange={setFromDay} />
          </View>
          <View style={styles.time}>
            <SelectField label="Heure de départ" options={TIME_OPTIONS} value={fromTime} onChange={setFromTime} />
          </View>
        </View>
        <View style={styles.pair}>
          <View style={styles.flex}>
            <DateField label="Date de retour" value={toDay} onChange={setToDay} min={fromDay} openOn={fromDay} />
          </View>
          <View style={styles.time}>
            <SelectField label="Heure de retour" options={TIME_OPTIONS} value={toTime} onChange={setToTime} />
          </View>
        </View>
        <LocationField label="Lieu de prise en charge" choice={pickupChoice} onChoice={setPickupChoice} other={pickupOther} onOther={setPickupOther} />
        <LocationField label="Lieu de dépôt" choice={returnChoice} onChoice={setReturnChoice} other={returnOther} onOther={setReturnOther} />
        <Button label={period ? "Changer la période" : "Voir les véhicules libres"} variant={period ? "secondary" : "primary"} onPress={choosePeriod} />
        {period ? (
          <Text style={styles.muted}>
            Du {formatDateTime(period.from)} au {formatDateTime(period.to)}
          </Text>
        ) : null}
      </Card>

      {period ? (
        <Card title="2. Véhicule">
          {availability.data?.past ? (
            <Text style={styles.muted}>Période passée : tous les véhicules sont proposés, sans contrôle de disponibilité.</Text>
          ) : null}
          {availability.isPending ? (
            <Text style={styles.muted}>Recherche des véhicules libres…</Text>
          ) : availability.isError ? (
            <Text style={styles.muted}>Les disponibilités n’ont pas pu être chargées.</Text>
          ) : (
            // L'API renvoie les véhicules libres d'abord, puis les indisponibles avec leur motif.
            vehicles.map((v) => {
              const active = v.id === vehicleId;
              const blocked = unavailableLabel(v);
              return (
                <Pressable
                  key={v.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: !v.available }}
                  accessibilityLabel={blocked ? `${v.name}, ${blocked.toLowerCase()}` : v.name}
                  disabled={!v.available}
                  onPress={() => setVehicleId(v.id)}
                  style={({ pressed }) => [
                    styles.option,
                    active && { backgroundColor: branding.primaryColor },
                    !v.available && styles.unavailable,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[styles.name, active && { color: branding.onPrimary }]}>{v.name}</Text>
                  <Text style={[styles.muted, active && { color: branding.onPrimary }]}>
                    {blocked ? `${blocked} sur cette période` : (v.plate ?? "Libre")}
                  </Text>
                </Pressable>
              );
            })
          )}
        </Card>
      ) : null}

      {period && vehicleId ? (
        <Card title="3. Locataire">
          <CustomerPicker selected={customer} onSelect={setCustomer} />
        </Card>
      ) : null}

      {period && vehicleId && customer ? (
        <Card title="4. Prix">
          <View style={styles.pair}>
            <View style={styles.flex}>
              <TextField label={`Prix (${currency})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" maxLength={12} />
            </View>
            <View style={styles.flex}>
              <TextField label={`Caution (${currency})`} value={deposit} onChangeText={setDeposit} keyboardType="decimal-pad" maxLength={12} />
            </View>
          </View>
          <TextField label="Notes (facultatif)" value={notes} onChangeText={setNotes} maxLength={2000} multiline />
          {zones.length > 0 ? (
            <>
              <Text style={styles.name}>Zone autorisée (facultatif)</Text>
              <Text style={styles.muted}>Une alerte est envoyée si le véhicule sort de cette zone pendant la location.</Text>
              <ChoiceChips
                options={[{ key: "none", label: "Aucune" }, ...zones.map((z) => ({ key: z.id, label: z.name }))]}
                value={zoneId}
                onChange={setZoneId}
                label="Zone autorisée"
              />
            </>
          ) : null}
        </Card>
      ) : null}

      {error ? <Banner message={error} tone="danger" /> : null}
      {period && vehicleId && customer ? <Button label="Créer la réservation" onPress={() => void submit()} loading={create.isPending} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: spacing.sm },
  page: { padding: spacing.lg, gap: spacing.md, width: "100%", maxWidth: 640, alignSelf: "center" },
  pair: { flexDirection: "row", gap: spacing.sm },
  time: { width: 130 },
  option: { minHeight: 56, justifyContent: "center", gap: 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface },
  unavailable: { opacity: 0.5 },
  chosen: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
