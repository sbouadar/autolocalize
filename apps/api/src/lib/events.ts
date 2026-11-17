import { z } from "zod";
import { prisma } from "./prisma.js";
import { knotsToKmh } from "./traccar.js";

// Événements transmis par Traccar (event.forward.url) : conversion vers nos types et enregistrement.

/** Types Traccar retenus et leur nom chez nous. Les autres (deviceMoving, commandResult…) sont ignorés. */
const TYPE_BY_TRACCAR: Record<string, EventType> = {
  geofenceEnter: "ZONE_ENTER",
  geofenceExit: "ZONE_EXIT",
  deviceOverspeed: "OVERSPEED",
  ignitionOn: "IGNITION_ON",
  ignitionOff: "IGNITION_OFF",
  deviceOnline: "DEVICE_ONLINE",
  deviceOffline: "DEVICE_OFFLINE",
  alarm: "ALARM",
};

export const EVENT_TYPES = ["ZONE_ENTER", "ZONE_EXIT", "OVERSPEED", "IGNITION_ON", "IGNITION_OFF", "DEVICE_ONLINE", "DEVICE_OFFLINE", "ALARM"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Types affichés dans la liste des alertes. Contact et retour en ligne sont enregistrés (ils
 * serviront aux règles : contact hors horaires…) mais ne sont pas des alertes en eux-mêmes.
 */
export const ALERT_TYPES: EventType[] = ["ZONE_ENTER", "ZONE_EXIT", "OVERSPEED", "DEVICE_OFFLINE", "ALARM"];

// Message de Traccar : seuls les champs utilisés sont décrits, le reste est ignoré.
const payloadSchema = z.object({
  event: z.object({
    id: z.number().int().positive(),
    type: z.string().max(64),
    eventTime: z.union([z.string(), z.number()]),
    deviceId: z.number().int().positive(),
    geofenceId: z.number().int().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  }),
  position: z
    .object({ latitude: z.number(), longitude: z.number(), speed: z.number().optional() })
    .nullish(),
});

export type RecordResult = "stored" | "duplicate" | "ignored" | "invalid";

/** Enregistre un événement transmis par Traccar, s'il concerne un véhicule d'un client. */
export async function recordTraccarEvent(body: unknown): Promise<RecordResult> {
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return "invalid";
  const { event, position } = parsed.data;
  const type = TYPE_BY_TRACCAR[event.type];
  if (!type) return "ignored";
  const eventTime = new Date(event.eventTime);
  if (Number.isNaN(eventTime.getTime())) return "invalid";

  const vehicle = await prisma.vehicle.findUnique({
    where: { traccarDeviceId: event.deviceId },
    select: { id: true, tenantId: true, name: true },
  });
  // Appareil Traccar non affecté à un client : rien à signaler à personne.
  if (!vehicle) return "ignored";

  // La zone doit appartenir au même client que le véhicule (sinon l'événement est gardé sans zone).
  const zone = event.geofenceId
    ? await prisma.zone.findFirst({
        where: { traccarGeofenceId: event.geofenceId, tenantId: vehicle.tenantId },
        select: { id: true, name: true },
      })
    : null;
  // Entrée ou sortie d'une geofence qui n'est pas une zone du client (créée à la main dans Traccar).
  if ((type === "ZONE_ENTER" || type === "ZONE_EXIT") && !zone) return "ignored";

  // Position 0,0 : traceur sans fix GPS, on ne l'affiche pas.
  const located = position && (position.latitude !== 0 || position.longitude !== 0) ? position : null;
  const alarm = event.attributes?.alarm;

  try {
    await prisma.event.create({
      data: {
        tenantId: vehicle.tenantId,
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        traccarEventId: event.id,
        type,
        eventTime,
        zoneId: zone?.id ?? null,
        zoneName: zone?.name ?? null,
        latitude: located?.latitude ?? null,
        longitude: located?.longitude ?? null,
        speedKmh: located?.speed !== undefined ? knotsToKmh(located.speed) : null,
        detail: type === "ALARM" && typeof alarm === "string" ? alarm.slice(0, 64) : null,
      },
    });
  } catch (err) {
    // Événement déjà reçu (Traccar retransmet en cas d'échec).
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") return "duplicate";
    throw err;
  }
  return "stored";
}
