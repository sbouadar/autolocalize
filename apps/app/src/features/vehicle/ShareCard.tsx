import { useState } from "react";
import { Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChoiceChips } from "@/components/ChoiceChips";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { formatDateTime } from "@/lib/format";
import { SHARE_DURATIONS, shareUrl, useShareLinkActions, useShareLinks, type ShareLink } from "@/lib/share-links";
import { colors, fonts, radius, spacing } from "@/lib/theme";

/** Envoie ou copie le lien : menu de partage sur mobile, presse-papiers sur le web. */
async function sendLink(url: string): Promise<"shared" | "copied" | "shown"> {
  if (Platform.OS !== "web") {
    await Share.share({ message: url });
    return "shared";
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "shown";
  }
}

/**
 * Bloc « Partager la position » (admin et agents) : lien public temporaire vers la position du
 * véhicule, sans compte. Le lien complet n'est visible qu'à sa création.
 */
export function ShareCard({ vehicleId }: { vehicleId: string }) {
  const { data } = useShareLinks(vehicleId);
  const { create, revoke } = useShareLinkActions(vehicleId);
  const [creating, setCreating] = useState(false);
  const [duration, setDuration] = useState("24");
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = (data?.links ?? []).filter((l) => l.active);

  const submit = async () => {
    setError(null);
    setNotice(null);
    try {
      const result = await create.mutateAsync({ durationHours: Number(duration), label: label.trim() || null });
      const url = shareUrl(result.path);
      setCreated(url);
      setCreating(false);
      setLabel("");
      const sent = await sendLink(url).catch(() => "shown" as const);
      setNotice(sent === "copied" ? "Lien copié : collez-le dans un message." : sent === "shared" ? null : "Copiez le lien ci-dessous.");
    } catch (err) {
      setError(formMessage(err));
    }
  };

  const stop = async (l: ShareLink) => {
    if (!(await confirmAction("Désactiver ce lien ?", "La personne qui l’a reçu ne verra plus la position.", "Désactiver"))) return;
    setError(null);
    try {
      await revoke(l.id);
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <Card title="Partager la position" right={!creating ? <Button label="Créer un lien" variant="secondary" onPress={() => setCreating(true)} /> : null}>
      <Text style={styles.muted}>Un lien temporaire montre la position du véhicule sans compte : ni plaque, ni historique.</Text>
      {creating ? (
        <View style={styles.form}>
          <ChoiceChips options={SHARE_DURATIONS} value={duration} onChange={setDuration} label="Durée du lien" tone="fill" />
          <TextField label="Pour qui ? (facultatif)" value={label} onChangeText={setLabel} maxLength={100} placeholder="ex. client, dépanneuse" />
          <View style={styles.pair}>
            <View style={styles.flex}>
              <Button label="Créer et partager" onPress={() => void submit()} loading={create.isPending} />
            </View>
            <View style={styles.flex}>
              <Button label="Annuler" variant="secondary" onPress={() => setCreating(false)} disabled={create.isPending} />
            </View>
          </View>
        </View>
      ) : null}
      {created ? (
        <View style={styles.created}>
          <Text selectable style={styles.url} accessibilityLabel="Lien de partage">
            {created}
          </Text>
          <Text style={styles.muted}>Ce lien ne sera plus affiché : envoyez-le maintenant.</Text>
        </View>
      ) : null}
      {notice ? <Banner message={notice} /> : null}
      {error ? <Banner message={error} tone="danger" /> : null}
      {active.map((l) => (
        <View key={l.id} style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.name}>{l.label ?? "Lien sans nom"}</Text>
            <Text style={styles.muted}>actif jusqu’au {formatDateTime(l.expiresAt)}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Désactiver le lien ${l.label ?? "sans nom"}`} onPress={() => void stop(l)} hitSlop={8}>
            <Text style={styles.danger}>Désactiver</Text>
          </Pressable>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: spacing.md },
  pair: { flexDirection: "row", gap: spacing.sm },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  created: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  url: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  danger: { fontFamily: fonts.bold, fontSize: 13, color: colors.danger },
});
