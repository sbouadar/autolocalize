import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ApiError, formMessage } from "@/lib/api";
import {
  COMMAND_LABELS,
  COMMAND_STATUS_LABELS,
  confirmationMessage,
  useSendCommand,
  useVehicleCommands,
  type EngineCommand,
} from "@/lib/commands";
import { confirmAction } from "@/lib/confirm";
import { formatDateTime } from "@/lib/format";
import { colors, radius, spacing } from "@/lib/theme";
import type { Vehicle } from "@/lib/types";
import { isMoving } from "@/lib/vehicles";

/** Coupure et rétablissement du moteur, avec confirmation et historique des envois. */
export function EngineCard({ vehicle }: { vehicle: Vehicle }) {
  const commands = useVehicleCommands(vehicle.id);
  const send = useSendCommand(vehicle.id);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const data = commands.data;
  // Rien à proposer : traceur sans relais, ou compte en lecture seule sans historique à montrer.
  if (!data || (!data.canSend && data.history.length === 0)) return null;
  const supported = data.supported;
  const canStop = data.canSend && supported?.ENGINE_STOP === true;
  const canResume = data.canSend && supported?.ENGINE_RESUME === true;

  const run = async (command: EngineCommand) => {
    const p = vehicle.position;
    const ok = await confirmAction(
      command === "ENGINE_STOP" ? "Couper le moteur ?" : "Rétablir le moteur ?",
      confirmationMessage(command, p?.speedKmh ?? null, isMoving(p)),
      command === "ENGINE_STOP" ? "Couper le moteur" : "Rétablir",
    );
    if (!ok) return;
    setMessage(null);
    try {
      const result = await send.mutateAsync(command);
      setMessage({
        tone: "ok",
        text: result.queued
          ? `${COMMAND_LABELS[command]} : traceur hors ligne, la commande sera transmise à sa prochaine connexion.`
          : `${COMMAND_LABELS[command]} : commande transmise au traceur.`,
      });
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof ApiError && err.status === 429 ? "Une commande vient d’être envoyée : patientez une minute." : formMessage(err),
      });
    }
  };

  return (
    <Card title="Moteur">
      {data.canSend && supported === null ? (
        <Text style={styles.muted}>Service de commande momentanément indisponible.</Text>
      ) : null}
      {data.canSend && supported && !canStop && !canResume ? (
        <Text style={styles.muted}>Ce traceur ne prend pas en charge la coupure du moteur à distance.</Text>
      ) : null}
      {canStop || canResume ? (
        <View style={styles.actions}>
          {canStop ? (
            <View style={styles.action}>
              <Button label="Couper le moteur" variant="danger" loading={send.isPending} onPress={() => void run("ENGINE_STOP")} />
            </View>
          ) : null}
          {canResume ? (
            <View style={styles.action}>
              <Button label="Rétablir le moteur" variant="secondary" disabled={send.isPending} onPress={() => void run("ENGINE_RESUME")} />
            </View>
          ) : null}
        </View>
      ) : null}
      {canStop ? (
        <Text style={styles.muted}>
          Le véhicule ne pourra plus redémarrer jusqu’au rétablissement. Le démarrage à distance n’est pas possible.
        </Text>
      ) : null}
      {message ? (
        <Text style={message.tone === "ok" ? styles.ok : styles.error} accessibilityRole="alert">
          {message.text}
        </Text>
      ) : null}
      {data.history.length > 0 ? (
        <View style={styles.history}>
          <Text style={styles.subtitle}>Derniers envois</Text>
          {data.history.slice(0, 5).map((h) => (
            <Text key={h.id} style={styles.muted}>
              {formatDateTime(h.createdAt)} · {COMMAND_LABELS[h.command]} · {COMMAND_STATUS_LABELS[h.status]} · {h.userName}
              {h.reason ? ` (${h.reason})` : ""}
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  action: { flexGrow: 1, flexBasis: 180 },
  muted: { fontSize: 13, color: colors.muted },
  subtitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  history: { gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  ok: { fontSize: 14, color: colors.online, backgroundColor: "#F0FDF4", padding: spacing.sm, borderRadius: radius.sm },
  error: { fontSize: 14, color: colors.danger, backgroundColor: colors.dangerSoft, padding: spacing.sm, borderRadius: radius.sm },
});
