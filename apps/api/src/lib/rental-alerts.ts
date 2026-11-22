import type { TaskContext } from "../jobs/scheduler.js";
import { todayIn } from "./deadlines.js";
import { recordAppEvent } from "./events.js";
import { prisma } from "./prisma.js";
import { knotsToKmh, traccar } from "./traccar.js";

// Alertes du module location (tâche planifiée, toutes les 5 minutes) :
// - retour en retard : location en cours dont la fin prévue est dépassée ;
// - usage hors location : véhicule d'un client loueur qui roule ou a le contact mis alors qu'aucune
//   location n'est en cours pour lui, hors indisponibilité (entretien, réparation…).
// Aucune coupure moteur automatique : ces alertes informent seulement.

/** Position plus ancienne que ce délai : on n'en déduit rien sur l'usage actuel du véhicule. */
const FRESH_POSITION_MS = 10 * 60_000;
const MOVING_SPEED_KMH = 3;

function frenchDateTime(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(date).replace(/[\u202f\u00a0]/g, " ");
  } catch {
    return date.toISOString();
  }
}

export async function overdueRentalsTask({ now }: TaskContext): Promise<void> {
  const late = await prisma.rental.findMany({
    where: { status: "ONGOING", endAt: { lt: now }, tenant: { rentalsEnabled: true, status: "ACTIVE" } },
    select: { id: true, tenantId: true, vehicleId: true, vehicleName: true, endAt: true, tenant: { select: { timezone: true } } },
    take: 500,
  });
  for (const r of late) {
    await recordAppEvent({
      tenantId: r.tenantId,
      vehicleId: r.vehicleId,
      vehicleName: r.vehicleName,
      type: "RENTAL_OVERDUE",
      eventTime: now,
      // La fin prévue est dans la clé : une location prolongée puis de nouveau en retard alerte à nouveau.
      dedupKey: `rental:${r.id}:overdue:${r.endAt.toISOString()}`,
      rentalId: r.id,
      message: `Retour en retard : le véhicule était attendu le ${frenchDateTime(r.endAt, r.tenant.timezone)}`,
    });
  }
}

export async function unauthorizedUseTask({ now, log }: TaskContext): Promise<void> {
  const tenants = await prisma.tenant.findMany({
    where: { rentalsEnabled: true, status: "ACTIVE" },
    select: {
      id: true,
      timezone: true,
      vehicles: {
        where: {
          rentals: { none: { status: "ONGOING" } },
          vehicleUnavailabilities: { none: { startAt: { lte: now }, OR: [{ endAt: null }, { endAt: { gt: now } }] } },
        },
        select: { id: true, name: true, traccarDeviceId: true },
      },
    },
  });
  const vehicles = tenants.flatMap((t) => t.vehicles.map((v) => ({ ...v, tenantId: t.id, timezone: t.timezone })));
  if (vehicles.length === 0) return;

  let devices;
  let positions;
  try {
    devices = await traccar.getDevices(vehicles.map((v) => v.traccarDeviceId));
    positions = await traccar.getPositions(devices.map((d) => d.positionId));
  } catch (err) {
    // Traccar indisponible : on réessaiera à la passe suivante.
    log.warn({ err }, "Usage hors location : Traccar indisponible");
    return;
  }
  const online = new Set(devices.filter((d) => d.status === "online" && !d.disabled).map((d) => d.id));
  const positionByDevice = new Map(positions.map((p) => [p.deviceId, p]));

  for (const v of vehicles) {
    const p = positionByDevice.get(v.traccarDeviceId);
    if (!p || !online.has(v.traccarDeviceId)) continue;
    if (now.getTime() - Date.parse(p.fixTime) > FRESH_POSITION_MS) continue;
    const moving = p.attributes.motion ?? knotsToKmh(p.speed) >= MOVING_SPEED_KMH;
    if (!moving && p.attributes.ignition !== true) continue;
    await recordAppEvent({
      tenantId: v.tenantId,
      vehicleId: v.id,
      vehicleName: v.name,
      type: "RENTAL_UNAUTHORIZED_USE",
      eventTime: now,
      // Une alerte par véhicule et par jour (fuseau du client), pas une toutes les 5 minutes.
      dedupKey: `rental-unauthorized:${v.id}:${todayIn(v.timezone, now)}`,
      message: moving ? "Véhicule en mouvement sans location en cours" : "Contact mis sans location en cours",
    });
  }
}
