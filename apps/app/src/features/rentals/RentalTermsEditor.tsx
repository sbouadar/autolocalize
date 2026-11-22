import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { useRentalSettings, useSaveRentalTerms } from "@/lib/rentals";
import { colors, fonts, spacing } from "@/lib/theme";

/** Conditions générales de location du loueur, reprises dans chaque contrat généré ensuite. */
export function RentalTermsEditor() {
  const { data, isPending } = useRentalSettings();
  if (isPending || !data) return <Text style={styles.muted}>Chargement…</Text>;
  return <Editor key={data.rentalTerms ?? ""} initial={data.rentalTerms ?? ""} />;
}

function Editor({ initial }: { initial: string }) {
  const save = useSaveRentalTerms();
  const [terms, setTerms] = useState(initial);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const submit = async () => {
    setMessage(null);
    try {
      await save.mutateAsync(terms.trim() || null);
      setMessage({ tone: "ok", text: "Conditions enregistrées : elles figureront sur les prochains contrats." });
    } catch (err) {
      setMessage({ tone: "error", text: formMessage(err) });
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.muted}>
        Texte imprimé sur chaque contrat (assurance, franchise, carburant, kilométrage, retard…). Les contrats déjà générés ne changent pas.
      </Text>
      <TextField label="Conditions générales" value={terms} onChangeText={setTerms} multiline maxLength={20_000} style={styles.input} />
      {message ? <Banner message={message.text} tone={message.tone === "error" ? "danger" : "warning"} /> : null}
      <Button label="Enregistrer les conditions" variant="secondary" onPress={() => void submit()} loading={save.isPending} disabled={terms.trim() === initial.trim()} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  input: { minHeight: 160, textAlignVertical: "top", paddingTop: spacing.sm },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
