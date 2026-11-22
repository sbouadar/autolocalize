import type { TaskContext } from "../jobs/scheduler.js";
import { recordAppEvent } from "./events.js";
import { prisma } from "./prisma.js";
import { knotsToKmh, traccar } from "./traccar.js";

// Règles d'alerte des clients (alertes, tranche 3), évaluées toutes les 5 minutes :
// - AFTER_HOURS : contact mis ou véhicule en mouvement hors de la plage horaire autorisée ;
// - OFFLINE_DURATION : traceur sans nouvelle position depuis plus de N minutes ;
// - ZONE_DWELL : véhicule entré dans une zone (événement Traccar) et pas ressorti depuis N minutes.

/** Position récente (ms) : au-delà, le contact ou le mouvement relevé n'est plus d'actualité. */
const FRESH_POSITION_MS = 10 * 60_000;
const MOVING_SPEED_KMH = 5;
const DAY_LABELS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/** Jour de la semaine (1 = lundi … 7 = dimanche), minutes depuis minuit et date, à l'heure du client. */
export function localClock(now: Date, timeZone: string): { weekday: number; minutes: number; date: string } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    return localClock(now, "Africa/Casablanca");
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")), date: `${get("year")}-${get("month")}-${get("day")}` };
}

export const parseDays = (days: string | null) =>
  (days ?? "")
    .split(",")
    .map(Number)
    .filter((d) => d >= 1 && d <= 7);

/** Dans la plage autorisée ? Une plage qui finit avant de commencer passe minuit (ex. 22:00 → 06:00). */
export function withinHours(clock: { weekday: number; minutes: number }, rule: { startMinute: number; endMinute: number; days: number[] }): boolean {
  if (!rule.days.includes(clock.weekday)) return false;
  const { startMinute: s, endMinute: e } = rule;
  return s <= e ? clock.minutes >= s && clock.minutes < e : clock.minutes >= s || clock.minutes < e;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export function describeHours(rule: { startMinute: number; endMinute: number; days: number[] }): string {
  return `${rule.days.map((d) => DAY_LABELS[d - 1]).join(" ")} ${hhmm(rule.startMinute)}–${hhmm(rule.endMinute)}`;
}

export function describeDuration(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} jour${minutes >= 2880 ? "s" : ""}`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`;
}

export async function alertRulesTask({ now, log }: TaskContext): Promise<void> {
  const rules = await prisma.alertRule.findMany({
    where: { enabled: true, tenant: { status: "ACTIVE" } },
    select: {
      id: true,
      type: true,
      vehicleId: true,
      zoneId: true,
      startMinute: true,
      endMinute: true,
      days: true,
      thresholdMinutes: true,
      zone: { select: { name: true } },
      tenant: { select: { id: true, timezone: true, vehicles: { select: { id: true, name: true, traccarDeviceId: true } } } },
    },
  });
  if (rules.length === 0) return;

  const needsTraccar = rules.some((r) => r.type !== "ZONE_DWELL");
  let devices = new Map<number, Awaited<ReturnType<typeof traccar.listDevices>>[number]>();
  let positions = new Map<number, Awaited<ReturnType<typeof traccar.getPositions>>[number]>();
  let traccarOk = true;
  if (needsTraccar) {
    try {
      const list = await traccar.listDevices();
      devices = new Map(list.map((d) => [d.id, d]));
      const wanted = new Set(rules.flatMap((r) => r.tenant.vehicles.map((v) => v.traccarDeviceId)));
      const ps = await traccar.getPositions(list.filter((d) => wanted.has(d.id)).map((d) => d.positionId));
      positions = new Map(ps.map((p) => [p.deviceId, p]));
    } catch (err) {
      log.warn({ err }, "Règles d'alerte : Traccar indisponible");
      traccarOk = false;
    }
  }

  for (const rule of rules) {
    const vehicles = rule.vehicleId ? rule.tenant.vehicles.filter((v) => v.id === rule.vehicleId) : rule.tenant.vehicles;
    const tenantId = rule.tenant.id;

    if (rule.type === "AFTER_HOURS" && traccarOk && rule.startMinute != null && rule.endMinute != null) {
      const window = { startMinute: rule.startMinute, endMinute: rule.endMinute, days: parseDays(rule.days) };
      const clock = localClock(now, rule.tenant.timezone);
      if (withinHours(clock, window)) continue;
      for (const v of vehicles) {
        const device = devices.get(v.traccarDeviceId);
        const p = positions.get(v.traccarDeviceId);
        if (!device || device.disabled || device.status !== "online" || !p) continue;
        if (now.getTime() - Date.parse(p.fixTime) > FRESH_POSITION_MS) continue;
        const moving = p.attributes.motion ?? knotsToKmh(p.speed) >= MOVING_SPEED_KMH;
        if (!moving && p.attributes.ignition !== true) continue;
        await recordAppEvent({
          tenantId,
          vehicleId: v.id,
          vehicleName: v.name,
          type: "IGNITION_AFTER_HOURS",
          eventTime: now,
          // Une alerte par règle, véhicule et jour.
          dedupKey: `rule:${rule.id}:${v.id}:${clock.date}`,
          message: `${moving ? "Véhicule en mouvement" : "Contact mis"} hors des horaires autorisés (${describeHours(window)})`,
        });
      }
    }

    if (rule.type === "OFFLINE_DURATION" && traccarOk && rule.thresholdMinutes) {
      for (const v of vehicles) {
        const device = devices.get(v.traccarDeviceId);
        if (!device || device.disabled || !device.lastUpdate) continue;
        const silentMs = now.getTime() - Date.parse(device.lastUpdate);
        if (silentMs < rule.thresholdMinutes * 60_000) continue;
        await recordAppEvent({
          tenantId,
          vehicleId: v.id,
          vehicleName: v.name,
          type: "VEHICLE_OFFLINE_LONG",
          eventTime: now,
          // Une alerte par silence : la dernière nouvelle du traceur est dans la clé.
          dedupKey: `rule:${rule.id}:${v.id}:${device.lastUpdate}`,
          message: `Aucune nouvelle du traceur depuis plus de ${describeDuration(rule.thresholdMinutes)}`,
        });
      }
    }

    if (rule.type === "ZONE_DWELL" && rule.zoneId && rule.thresholdMinutes) {
      for (const v of vehicles) {
        // Dernier passage du véhicule à la limite de la zone : une entrée sans sortie depuis.
        const last = await prisma.event.findFirst({
          where: { vehicleId: v.id, zoneId: rule.zoneId, type: { in: ["ZONE_ENTER", "ZONE_EXIT"] } },
          orderBy: { eventTime: "desc" },
          select: { id: true, type: true, eventTime: true },
        });
        if (!last || last.type !== "ZONE_ENTER") continue;
        if (now.getTime() - last.eventTime.getTime() < rule.thresholdMinutes * 60_000) continue;
        await recordAppEvent({
          tenantId,
          vehicleId: v.id,
          vehicleName: v.name,
          type: "ZONE_DWELL",
          eventTime: now,
          dedupKey: `rule:${rule.id}:enter:${last.id}`,
          message: `Dans la zone ${rule.zone?.name ?? ""} depuis plus de ${describeDuration(rule.thresholdMinutes)}`.replace("zone  ", "zone "),
        });
      }
    }
  }
}
