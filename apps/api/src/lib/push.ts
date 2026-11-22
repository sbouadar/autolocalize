import type { FastifyBaseLogger } from "fastify";
import { config } from "../config.js";
import { prisma } from "./prisma.js";
import { knotsToKmh } from "./traccar.js";

// Notifications push des alertes (alertes, tranche 4) par Expo Push. Envoi « au mieux », sans
// bloquer l'enregistrement de l'alerte. Un appareil désinscrit (DeviceNotRegistered) est oublié.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK = 100;

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  sound: "default";
  channelId: string;
  data: Record<string, string>;
}
export type PushTicket = { status: "ok"; id: string } | { status: "error"; message?: string; details?: { error?: string } };
export type PushSender = (messages: PushMessage[]) => Promise<PushTicket[]>;

const expoSender: PushSender = async (messages) => {
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Expo Push : HTTP ${res.status}`);
  const json = (await res.json()) as { data?: PushTicket[] };
  return json.data ?? [];
};

// Pas d'envoi réel pendant les tests : ils installent leur propre expéditeur.
let sender: PushSender | null = config.NODE_ENV === "test" ? null : expoSender;
let logger: Pick<FastifyBaseLogger, "warn" | "error"> = console;

export function setPushSender(next: PushSender | null) {
  sender = next;
}
export function setPushLogger(log: Pick<FastifyBaseLogger, "warn" | "error">) {
  logger = log;
}

export interface AlertForPush {
  id: string;
  tenantId: string;
  vehicleId: string | null;
  vehicleName: string;
  type: string;
  message?: string | null;
  zoneName?: string | null;
  speedKmh?: number | null;
}

/** Texte de l'alerte (mêmes libellés que l'app). */
export function pushText(alert: AlertForPush): string {
  if (alert.message) return alert.message;
  switch (alert.type) {
    case "ZONE_ENTER":
      return alert.zoneName ? `Entrée dans la zone ${alert.zoneName}` : "Entrée dans une zone";
    case "ZONE_EXIT":
      return alert.zoneName ? `Sortie de la zone ${alert.zoneName}` : "Sortie d'une zone";
    case "OVERSPEED":
      return alert.speedKmh != null ? `Excès de vitesse (${Math.round(alert.speedKmh)} km/h)` : "Excès de vitesse";
    case "DEVICE_OFFLINE":
      return "Traceur hors ligne";
    case "ALARM":
      return "Alarme du traceur";
    default:
      return "Nouvelle alerte";
  }
}

/** Envoie l'alerte aux appareils des utilisateurs actifs du client qui ne l'ont pas masquée. */
export async function sendAlertPush(alert: AlertForPush): Promise<number> {
  if (!sender) return 0;
  const users = await prisma.user.findMany({
    where: { tenantId: alert.tenantId, disabledAt: null, pushTokens: { some: {} } },
    select: { mutedAlertTypes: true, pushTokens: { select: { token: true } } },
  });
  const tokens = users
    .filter((u) => !(Array.isArray(u.mutedAlertTypes) && (u.mutedAlertTypes as unknown[]).includes(alert.type)))
    .flatMap((u) => u.pushTokens.map((t) => t.token));
  if (tokens.length === 0) return 0;
  const body = pushText(alert);
  const messages: PushMessage[] = tokens.map((to) => ({
    to,
    title: alert.vehicleName,
    body,
    sound: "default",
    channelId: "alerts",
    data: { eventId: alert.id, ...(alert.vehicleId && { vehicleId: alert.vehicleId }) },
  }));
  let sent = 0;
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    const tickets = await sender(chunk);
    const gone = chunk.filter((_, j) => {
      const t = tickets[j];
      return t?.status === "error" && t.details?.error === "DeviceNotRegistered";
    });
    if (gone.length) await prisma.pushToken.deleteMany({ where: { token: { in: gone.map((m) => m.to) } } });
    sent += tickets.filter((t) => t.status === "ok").length;
  }
  return sent;
}

/** Envoi sans attendre ni faire échouer l'appelant. */
export function notifyAlert(alert: AlertForPush): void {
  if (!sender) return;
  void sendAlertPush(alert).catch((err) => logger.warn({ err }, "Notification push non envoyée"));
}

/** Pour les tests : attend la fin des envois en cours. */
export async function sendAlertPushNow(alert: AlertForPush) {
  return sendAlertPush(alert);
}
