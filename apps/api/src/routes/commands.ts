import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import type { CommandStatus, EngineCommand } from "../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { knotsToKmh, traccar } from "../lib/traccar.js";
import { findOwnedVehicle } from "./vehicles.js";

// Coupure et rétablissement du moteur à distance. Décisions de l'utilisateur (2026-10-29) :
// autorisé quelle que soit la vitesse, après confirmation dans l'application (qui affiche la
// dernière vitesse connue) ; réservé au compte du client (TENANT_ADMIN) et au super-admin.
// Chaque demande, acceptée ou refusée, est journalisée dans command_log.

const TRACCAR_TYPES: Record<EngineCommand, string> = {
  ENGINE_STOP: "engineStop",
  ENGINE_RESUME: "engineResume",
};

/** Une commande envoyée par véhicule et par minute au plus (évite les doubles appuis et l'acharnement). */
const MIN_INTERVAL_MS = 60_000;
const HISTORY_SIZE = 20;

const commandBody = z.object({ command: z.enum(["ENGINE_STOP", "ENGINE_RESUME"]) }).strict();

type Vehicle = NonNullable<Awaited<ReturnType<typeof findOwnedVehicle>>>;

/** Dernière vitesse connue (km/h), pour le journal ; null si Traccar ne la fournit pas. */
async function lastKnownSpeed(vehicle: Vehicle): Promise<number | null> {
  try {
    const [device] = await traccar.getDevices([vehicle.traccarDeviceId]);
    if (!device) return null;
    const [position] = await traccar.getPositions([device.positionId]);
    return position ? knotsToKmh(position.speed) : null;
  } catch {
    return null;
  }
}

async function logCommand(
  request: FastifyRequest,
  vehicle: Vehicle,
  command: EngineCommand,
  status: CommandStatus,
  extra: { reason?: string; lastKnownSpeed?: number | null; traccarResponse?: string },
) {
  await prisma.commandLog.create({
    data: {
      tenantId: vehicle.tenantId,
      userId: request.currentUser!.id,
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
      traccarDeviceId: vehicle.traccarDeviceId,
      command,
      status,
      reason: extra.reason ?? null,
      lastKnownSpeed: extra.lastKnownSpeed ?? null,
      traccarResponse: extra.traccarResponse ?? null,
      ipAddress: request.ip,
    },
  });
}

const commandRoutes: FastifyPluginAsync = async (app) => {
  // Commandes possibles pour ce véhicule et derniers envois (tout utilisateur du client peut consulter).
  app.get("/vehicles/:id/commands", { preHandler: app.requireAuth }, async (request, reply) => {
    const vehicle = await findOwnedVehicle(request);
    if (!vehicle) return reply.notFound();

    let supported: Record<EngineCommand, boolean> | null = null;
    try {
      const types = await traccar.getCommandTypes(vehicle.traccarDeviceId);
      supported = {
        ENGINE_STOP: types.includes(TRACCAR_TYPES.ENGINE_STOP),
        ENGINE_RESUME: types.includes(TRACCAR_TYPES.ENGINE_RESUME),
      };
    } catch (err) {
      request.log.error({ err }, "Types de commandes Traccar indisponibles");
    }

    const history = await prisma.commandLog.findMany({
      where: { vehicleId: vehicle.id },
      orderBy: { createdAt: "desc" },
      take: HISTORY_SIZE,
      select: { id: true, command: true, status: true, reason: true, createdAt: true, user: { select: { name: true } } },
    });

    const role = request.currentUser!.role;
    return {
      canSend: role === "TENANT_ADMIN" || role === "SUPER_ADMIN",
      supported,
      history: history.map(({ user, ...h }) => ({ ...h, userName: user.name })),
    };
  });

  app.post(
    "/vehicles/:id/commands",
    {
      preHandler: [app.requireAuth, app.requireRole("TENANT_ADMIN", "SUPER_ADMIN")],
      // Limite par IP (10 par minute), relâchée seulement pour les tests automatisés.
      config: { rateLimit: { max: config.NODE_ENV === "test" ? 1000 : 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const vehicle = await findOwnedVehicle(request);
      if (!vehicle) return reply.notFound();
      const parsed = commandBody.safeParse(request.body);
      if (!parsed.success) return reply.badRequest("Commande inconnue");
      const { command } = parsed.data;
      const speed = await lastKnownSpeed(vehicle);

      const recent = await prisma.commandLog.findFirst({
        where: { vehicleId: vehicle.id, status: "SENT", createdAt: { gte: new Date(Date.now() - MIN_INTERVAL_MS) } },
        select: { id: true },
      });
      if (recent) {
        await logCommand(request, vehicle, command, "REJECTED", { reason: "Moins d'une minute après la commande précédente", lastKnownSpeed: speed });
        return reply.tooManyRequests("Une commande vient d'être envoyée à ce véhicule : patientez une minute.");
      }

      let types: string[];
      try {
        types = await traccar.getCommandTypes(vehicle.traccarDeviceId);
      } catch (err) {
        request.log.error({ err }, "Types de commandes Traccar indisponibles");
        await logCommand(request, vehicle, command, "FAILED", { reason: "Traccar injoignable", lastKnownSpeed: speed });
        return reply.serviceUnavailable("Service de commande momentanément indisponible");
      }
      if (!types.includes(TRACCAR_TYPES[command])) {
        await logCommand(request, vehicle, command, "REJECTED", { reason: "Commande non prise en charge par le traceur", lastKnownSpeed: speed });
        return reply.code(409).send({
          statusCode: 409,
          error: "Ce traceur ne prend pas en charge cette commande",
          code: "COMMAND_UNSUPPORTED",
        });
      }

      let queued: boolean;
      try {
        ({ queued } = await traccar.sendCommand(vehicle.traccarDeviceId, TRACCAR_TYPES[command]));
      } catch (err) {
        request.log.error({ err }, "Échec de l'envoi de la commande Traccar");
        await logCommand(request, vehicle, command, "FAILED", { reason: "Refus ou erreur de Traccar", lastKnownSpeed: speed });
        return reply.serviceUnavailable("La commande n'a pas pu être envoyée");
      }

      await logCommand(request, vehicle, command, "SENT", {
        lastKnownSpeed: speed,
        traccarResponse: queued ? "En attente : transmise à la prochaine connexion du traceur" : "Transmise au traceur",
      });
      return { status: "SENT", queued };
    },
  );
};

export default commandRoutes;
