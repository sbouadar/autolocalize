// Commandes moteur : GET/POST /vehicles/:id/commands (voir apps/api/src/routes/commands.ts).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";

export const engineCommandSchema = z.enum(["ENGINE_STOP", "ENGINE_RESUME"]);
export type EngineCommand = z.infer<typeof engineCommandSchema>;

const commandsSchema = z.object({
  canSend: z.boolean(),
  supported: z.object({ ENGINE_STOP: z.boolean(), ENGINE_RESUME: z.boolean() }).nullable(),
  history: z.array(
    z.object({
      id: z.string(),
      command: engineCommandSchema,
      status: z.enum(["SENT", "REJECTED", "FAILED"]),
      reason: z.string().nullable(),
      createdAt: z.string(),
      userName: z.string(),
    }),
  ),
});
export type VehicleCommands = z.infer<typeof commandsSchema>;

const sendResultSchema = z.object({ status: z.literal("SENT"), queued: z.boolean() });

export const COMMAND_LABELS: Record<EngineCommand, string> = {
  ENGINE_STOP: "Coupure du moteur",
  ENGINE_RESUME: "Rétablissement du moteur",
};

export const COMMAND_STATUS_LABELS: Record<VehicleCommands["history"][number]["status"], string> = {
  SENT: "envoyée",
  REJECTED: "refusée",
  FAILED: "échec",
};

const commandsKey = (id: string) => ["vehicles", id, "commands"] as const;

export function useVehicleCommands(id: string) {
  return useQuery({
    queryKey: commandsKey(id),
    queryFn: () => api(`/vehicles/${encodeURIComponent(id)}/commands`, { schema: commandsSchema }),
  });
}

export function useSendCommand(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: EngineCommand) =>
      api(`/vehicles/${encodeURIComponent(id)}/commands`, { method: "POST", body: { command }, schema: sendResultSchema }),
    // Succès comme refus sont journalisés côté serveur : l'historique est à recharger dans les deux cas.
    onSettled: () => queryClient.invalidateQueries({ queryKey: commandsKey(id) }),
  });
}

/** Message de confirmation : la vitesse est rappelée, la coupure étant possible en roulant. */
export function confirmationMessage(command: EngineCommand, speedKmh: number | null, moving: boolean): string {
  if (command === "ENGINE_RESUME") {
    return "Le moteur pourra de nouveau démarrer. La commande est transmise au traceur dès sa prochaine connexion.";
  }
  const speed =
    speedKmh == null
      ? "Vitesse actuelle inconnue."
      : moving
        ? `Le véhicule roule actuellement à ${Math.round(speedKmh)} km/h.`
        : "Le véhicule semble à l’arrêt.";
  return `${speed} Couper le moteur d’un véhicule en mouvement peut provoquer un accident. Confirmez-vous la coupure ?`;
}
