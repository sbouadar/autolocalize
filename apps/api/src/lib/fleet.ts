import type { FastifyBaseLogger } from "fastify";
import type { CurrentUser } from "../plugins/auth-context.js";
import { knotsToKmh, traccar, type TraccarDevice, type TraccarPosition } from "./traccar.js";

// createdAt = date d'affectation du traceur au client : borne l'historique visible (voir period.ts).
export const vehicleSelect = { id: true, tenantId: true, name: true, plate: true, traccarDeviceId: true, createdAt: true } as const;
export type VehicleRow = {
  id: string;
  tenantId: string;
  name: string;
  plate: string | null;
  traccarDeviceId: number;
  createdAt: Date;
};

/** Restriction par client : le super-admin voit tout, les autres uniquement leur tenant. */
export function tenantScope(user: CurrentUser) {
  return user.role === "SUPER_ADMIN" ? {} : { tenantId: user.tenantId! };
}

/** Complète les véhicules avec l'état et la dernière position Traccar. */
export async function withLiveData(vehicles: VehicleRow[], log: FastifyBaseLogger, user: CurrentUser) {
  let devices = new Map<number, TraccarDevice>();
  let positions = new Map<number, TraccarPosition>();
  let liveDataAvailable = true;

  try {
    const deviceList = await traccar.getDevices(vehicles.map((v) => v.traccarDeviceId));
    devices = new Map(deviceList.map((d) => [d.id, d]));

    const positionList = await traccar.getPositions(deviceList.map((d) => d.positionId));
    positions = new Map(positionList.map((p) => [p.deviceId, p]));
  } catch (err) {
    // Traccar indisponible : on renvoie quand même la liste, sans données temps réel.
    log.error({ err }, "Échec de l'appel à Traccar");
    liveDataAvailable = false;
  }

  return {
    liveDataAvailable,
    vehicles: vehicles.map((v) => {
      const device = devices.get(v.traccarDeviceId);
      const position = positions.get(v.traccarDeviceId);
      return {
        id: v.id,
        name: v.name,
        plate: v.plate,
        ...(user.role === "SUPER_ADMIN" && { tenantId: v.tenantId }),
        status: device?.status ?? "unknown",
        disabled: device?.disabled ?? false,
        lastUpdate: device?.lastUpdate ?? null,
        position: position
          ? {
              latitude: position.latitude,
              longitude: position.longitude,
              speedKmh: knotsToKmh(position.speed),
              course: position.course,
              fixTime: position.fixTime,
              address: position.address,
              ignition: position.attributes.ignition ?? null,
              motion: position.attributes.motion ?? null,
            }
          : null,
      };
    }),
  };
}
