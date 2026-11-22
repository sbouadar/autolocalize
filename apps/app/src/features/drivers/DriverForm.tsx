import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "@/components/Button";
import { DateField } from "@/components/DateField";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { useDriverActions, type Driver } from "@/lib/drivers";
import { spacing } from "@/lib/theme";

/** Création ou modification d'un conducteur (admin du client). */
export function DriverForm({ driver, onDone }: { driver?: Driver; onDone: (saved?: Driver) => void }) {
  const { create, update } = useDriverActions();
  const mutation = driver ? update : create;
  const [name, setName] = useState(driver?.name ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [email, setEmail] = useState(driver?.email ?? "");
  const [license, setLicense] = useState(driver?.licenseNumber ?? "");
  const [expires, setExpires] = useState<string | null>(driver?.licenseExpiresOn ?? null);
  const [notes, setNotes] = useState(driver?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError("Indiquez le nom du conducteur.");
    const body = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      licenseNumber: license.trim() || null,
      licenseExpiresOn: expires,
      notes: notes.trim() || null,
    };
    try {
      const result = driver ? await update.mutateAsync({ id: driver.id, body }) : await create.mutateAsync(body);
      onDone(result.driver);
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <View style={styles.form}>
      <TextField label="Nom" value={name} onChangeText={setName} maxLength={191} autoComplete="name" />
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label="Téléphone (facultatif)" value={phone} onChangeText={setPhone} maxLength={32} keyboardType="phone-pad" />
        </View>
        <View style={styles.flex}>
          <TextField label="E-mail (facultatif)" value={email} onChangeText={setEmail} maxLength={191} keyboardType="email-address" autoCapitalize="none" />
        </View>
      </View>
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label="N° de permis (facultatif)" value={license} onChangeText={setLicense} maxLength={64} autoCapitalize="characters" />
        </View>
        <View style={styles.flex}>
          <DateField label="Permis valable jusqu’au" value={expires} onChange={setExpires} openOn={null} />
        </View>
      </View>
      <TextField label="Notes (facultatif)" value={notes} onChangeText={setNotes} maxLength={500} />
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label="Enregistrer" onPress={() => void save()} loading={mutation.isPending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={() => onDone()} disabled={mutation.isPending} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: spacing.md },
  pair: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
