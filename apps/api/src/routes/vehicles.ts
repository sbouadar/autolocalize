import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { knotsToKmh, traccar, type TraccarDevice, type TraccarPosition } from "../lib/traccar.js";

const vehicleRoutes: FastifyPluginAsync = async (app) => {
  // Véhicules du client connecté, complétés par l'état et la dernière position Traccar.
  app.get("/vehicles", { preHandler: app.requireAuth }, async (request) => {
    const user = request.currentUser!;

    const vehicles = await prisma.vehicle.findMany({
      // Le super-admin voit tout ; les autres uniquement leur tenant.
      where: user.role === "SUPER_ADMIN" ? {} : { tenantId: user.tenantId! },
      select: { id: true, tenantId: true, name: true, plate: true, traccarDeviceId: true },
      orderBy: { name: "asc" },
    });

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
      request.log.error({ err }, "Échec de l'appel à Traccar");
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
  });
};

export default vehicleRoutes;
