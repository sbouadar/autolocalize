import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { ChoiceChips } from "@/components/ChoiceChips";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { ApiError, formMessage } from "@/lib/api";
import { formatDateOnly, parseFrenchDate } from "@/lib/dates";
import { ID_DOCUMENT_LABELS, idDocumentTypeSchema, useCustomerActions, type Customer, type CustomerInput, type IdDocumentType } from "@/lib/rentals";
import { colors, fonts, spacing } from "@/lib/theme";

const KIND_OPTIONS = [
  { key: "PERSON" as const, label: "Particulier" },
  { key: "COMPANY" as const, label: "Société" },
];
const ID_OPTIONS = idDocumentTypeSchema.options.map((key) => ({ key, label: ID_DOCUMENT_LABELS[key] }));

interface CustomerFormProps {
  /** Locataire à modifier ; absent : création. */
  customer?: Customer;
  onSaved: (customer: Customer) => void;
  onCancel: () => void;
}

/**
 * Création ou modification d'un locataire. Les numéros de pièce et de permis ne sont jamais
 * préremplis (l'app ne les connaît que masqués) : laissés vides, ils restent inchangés.
 */
export function CustomerForm({ customer, onSaved, onCancel }: CustomerFormProps) {
  const { create, update } = useCustomerActions();
  const [kind, setKind] = useState<"PERSON" | "COMPANY">(customer?.kind ?? "PERSON");
  const [idType, setIdType] = useState<IdDocumentType | null>(customer?.idDocumentType ?? "NATIONAL_ID");
  const [form, setForm] = useState({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    birthDate: customer?.birthDate ? formatDateOnly(customer.birthDate) : "",
    idNumber: "",
    license: "",
    licenseExpiresOn: customer?.licenseExpiresOn ? formatDateOnly(customer.licenseExpiresOn) : "",
    notes: customer?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const pending = create.isPending || update.isPending;

  const save = async () => {
    setError(null);
    if (!form.name.trim()) return setError("Le nom est obligatoire.");
    const dates: Record<"birthDate" | "licenseExpiresOn", string | null> = { birthDate: null, licenseExpiresOn: null };
    for (const key of ["birthDate", "licenseExpiresOn"] as const) {
      if (!form[key].trim()) continue;
      const parsed = parseFrenchDate(form[key]);
      if (!parsed) return setError("Saisissez les dates au format JJ/MM/AAAA.");
      dates[key] = parsed;
    }
    const body: CustomerInput = {
      kind,
      name: form.name.trim(),
      phone: form.phone,
      email: form.email,
      address: form.address,
      birthDate: dates.birthDate,
      licenseExpiresOn: dates.licenseExpiresOn,
      notes: form.notes,
      idDocumentType: idType,
      // Numéros : envoyés seulement s'ils sont saisis (sinon ils restent inchangés).
      ...(form.idNumber.trim() && { idDocumentNumber: form.idNumber.trim() }),
      ...(form.license.trim() && { licenseNumber: form.license.trim() }),
    };
    try {
      const result = customer ? await update.mutateAsync({ id: customer.id, body }) : await create.mutateAsync(body);
      onSaved(result.customer);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "CUSTOMER_DUPLICATE" ? `${err.message}. Recherchez-le dans la liste des locataires.` : formMessage(err),
      );
    }
  };

  return (
    <View style={styles.form}>
      <ChoiceChips options={KIND_OPTIONS} value={kind} onChange={setKind} label="Type de locataire" />
      <TextField label={kind === "COMPANY" ? "Raison sociale" : "Nom complet"} value={form.name} onChangeText={set("name")} maxLength={191} />
      <TextField label="Téléphone" value={form.phone} onChangeText={set("phone")} keyboardType="phone-pad" maxLength={32} />
      <TextField label="E-mail" value={form.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" maxLength={191} />
      <TextField label="Adresse" value={form.address} onChangeText={set("address")} maxLength={500} />
      {kind === "PERSON" ? (
        <TextField
          label="Date de naissance (JJ/MM/AAAA)"
          value={form.birthDate}
          onChangeText={set("birthDate")}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
      ) : null}

      <Text style={styles.section}>Pièce d’identité et permis</Text>
      <Text style={styles.muted}>Ces numéros sont enregistrés chiffrés et affichés masqués.</Text>
      <ChoiceChips options={ID_OPTIONS} value={idType} onChange={setIdType} label="Type de pièce d’identité" />
      <TextField
        label="N° de pièce d’identité"
        value={form.idNumber}
        onChangeText={set("idNumber")}
        placeholder={customer?.idDocumentMasked ? `${customer.idDocumentMasked} (inchangé si vide)` : undefined}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={64}
      />
      <TextField
        label="N° de permis de conduire"
        value={form.license}
        onChangeText={set("license")}
        placeholder={customer?.licenseMasked ? `${customer.licenseMasked} (inchangé si vide)` : undefined}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={64}
      />
      <TextField
        label="Expiration du permis (JJ/MM/AAAA)"
        value={form.licenseExpiresOn}
        onChangeText={set("licenseExpiresOn")}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      <TextField label="Notes" value={form.notes} onChangeText={set("notes")} maxLength={2000} multiline />

      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label={customer ? "Enregistrer" : "Créer le locataire"} onPress={() => void save()} loading={pending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={onCancel} disabled={pending} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: spacing.md },
  pair: { flexDirection: "row", gap: spacing.sm },
  section: { fontFamily: fonts.heavy, fontSize: 16, color: colors.text, marginTop: spacing.sm },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, marginTop: -spacing.sm },
});
