import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding-context";
import { parseLocalDateTime, todayFrench } from "@/lib/dates";
import { formatDateTime } from "@/lib/format";
import { parseAmount, useAvailability, useCustomers, useRentalActions, type Customer } from "@/lib/rentals";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { CustomerForm } from "./CustomerForm";

const SEARCH_DELAY_MS = 300;

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
  const [fromDate, setFromDate] = useState(todayFrench());
  const [fromTime, setFromTime] = useState("09:00");
  const [toDate, setToDate] = useState("");
  const [toTime, setToTime] = useState("09:00");
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [price, setPrice] = useState("");
  const [deposit, setDeposit] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const availability = useAvailability(period?.from ?? null, period?.to ?? null);

  const role = me?.user.role;
  if (me && (!me.tenant?.rentalsEnabled || (role !== "TENANT_ADMIN" && role !== "AGENT"))) return <Redirect href="/" />;
  const currency = me?.tenant?.currency ?? "MAD";

  const choosePeriod = () => {
    setError(null);
    const from = parseLocalDateTime(fromDate, fromTime);
    const to = parseLocalDateTime(toDate, toTime);
    if (!from || !to) return setError("Saisissez les dates au format JJ/MM/AAAA et les heures au format HH:MM.");
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

      <Card title="1. Période">
        <View style={styles.pair}>
          <View style={styles.flex}>
            <TextField label="Départ (JJ/MM/AAAA)" value={fromDate} onChangeText={setFromDate} keyboardType="numbers-and-punctuation" maxLength={10} />
          </View>
          <View style={styles.time}>
            <TextField label="Heure de départ" value={fromTime} onChangeText={setFromTime} keyboardType="numbers-and-punctuation" maxLength={5} />
          </View>
        </View>
        <View style={styles.pair}>
          <View style={styles.flex}>
            <TextField label="Retour (JJ/MM/AAAA)" value={toDate} onChangeText={setToDate} keyboardType="numbers-and-punctuation" maxLength={10} />
          </View>
          <View style={styles.time}>
            <TextField label="Heure de retour" value={toTime} onChangeText={setToTime} keyboardType="numbers-and-punctuation" maxLength={5} />
          </View>
        </View>
        <Button label={period ? "Changer la période" : "Voir les véhicules libres"} variant={period ? "secondary" : "primary"} onPress={choosePeriod} />
        {period ? (
          <Text style={styles.muted}>
            Du {formatDateTime(period.from)} au {formatDateTime(period.to)}
          </Text>
        ) : null}
      </Card>

      {period ? (
        <Card title="2. Véhicule">
          {availability.isPending ? (
            <Text style={styles.muted}>Recherche des véhicules libres…</Text>
          ) : availability.isError ? (
            <Text style={styles.muted}>Les disponibilités n’ont pas pu être chargées.</Text>
          ) : (
            vehicles.map((v) => {
              const active = v.id === vehicleId;
              return (
                <Pressable
                  key={v.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled: !v.available }}
                  accessibilityLabel={`${v.name}${v.available ? "" : v.reason === "RENTED" ? ", déjà loué" : ", indisponible"}`}
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
                    {v.available ? (v.plate ?? "Libre") : v.reason === "RENTED" ? "Déjà loué sur cette période" : "Indisponible sur cette période"}
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
