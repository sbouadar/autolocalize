import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { generateContractPdf, generateReturnReportPdf } from "../lib/contract-pdf.js";
import { decryptField } from "../lib/crypto.js";
import { gpsDistanceKm } from "../lib/odometer.js";
import { prisma } from "../lib/prisma.js";
import {
  decodePhoto,
  normalizePhoto,
  PHOTO_ERRORS,
  PHOTO_MAX_BYTES,
  PHOTOS_PER_PHASE,
  readRentalFile,
  removeRentalFile,
  saveRentalFile,
  sha256,
} from "../lib/rental-files.js";
import { RENTAL_READERS, RENTAL_WRITERS, requireRentalsModule } from "../lib/rentals.js";
import { firstIssue } from "../lib/tenant-branding.js";
import { traccar } from "../lib/traccar.js";
import { publicRental, rentalSelect } from "./rentals.js";
import { ZONES_PER_VEHICLE } from "./zones.js";

// Départ et retour du véhicule, photos d'état des lieux, contrat PDF et rapport de retour (M6).
// Tous les fichiers sont privés : servis seulement au client propriétaire, sans mise en cache.

const id = z.string().regex(/^[a-z0-9]{1,64}$/);
const dateTime = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const KM_MAX = 2_000_000;

const handoverBody = z
  .object({
    odometerKm: z.number().int().min(0).max(KM_MAX),
    /** Niveau de carburant en huitièmes de réservoir. */
    fuelLevel: z.number().int().min(0).max(8),
    /** Par défaut maintenant ; jamais dans le futur. */
    at: dateTime.refine((d) => d.getTime() <= Date.now() + 60_000, "La date ne peut pas être dans le futur").optional(),
  })
  .strict();

const photoBody = z
  .object({
    phase: z.enum(["PICKUP", "RETURN"]),
    data: z.string().min(1).max(Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 100),
    caption: z
      .string()
      .trim()
      .max(191)
      .nullable()
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .strict();

const termsBody = z
  .object({
    rentalTerms: z
      .string()
      .trim()
      .max(20_000)
      .nullable()
      .transform((v) => (v ? v : null)),
  })
  .strict();

const ID_DOCUMENT_LABELS: Record<string, string> = {
  NATIONAL_ID: "Carte d'identité n°",
  PASSPORT: "Passeport n°",
  RESIDENCE_PERMIT: "Titre de séjour n°",
  OTHER: "Pièce d'identité n°",
};

const tenantPdfSelect = { name: true, address: true, phone: true, email: true, logoUrl: true, timezone: true, currency: true, rentalTerms: true } as const;
const reference = (rentalId: string) => rentalId.slice(-8).toUpperCase();

function conflict(reply: FastifyReply, code: string, error: string) {
  return reply.code(409).send({ statusCode: 409, error, code });
}

function sendPrivateFile(reply: FastifyReply, bytes: Buffer, type: string, fileName: string) {
  return reply
    .header("Content-Type", type)
    .header("Content-Disposition", `inline; filename="${fileName}"`)
    .header("Cache-Control", "private, no-store")
    .header("X-Content-Type-Options", "nosniff")
    .send(bytes);
}

const rentalOpsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.requireAuth);
  app.addHook("preHandler", app.requireRole(...RENTAL_READERS));
  app.addHook("preHandler", requireRentalsModule);
  const writers = app.requireRole(...RENTAL_WRITERS);
  const adminOnly = app.requireRole("TENANT_ADMIN");

  const tenantOf = (request: FastifyRequest) => request.currentUser!.tenantId!;
  const rentalIdOf = (request: FastifyRequest) => id.safeParse((request.params as { id?: unknown }).id).data ?? null;

  /** Location du client connecté ; celle d'un autre client est traitée comme inexistante. */
  const findOwned = async (request: FastifyRequest) => {
    const rentalId = rentalIdOf(request);
    return rentalId ? prisma.rental.findFirst({ where: { id: rentalId, tenantId: tenantOf(request) }, select: rentalSelect }) : null;
  };

  /** Un compteur ne recule pas : relevé antérieur plus élevé que la valeur saisie. */
  const higherEarlierReading = (vehicleId: string, km: number, at: Date) =>
    prisma.odometerReading.findFirst({ where: { vehicleId, readAt: { lte: at }, km: { gt: km } }, select: { km: true } });

  /**
   * La zone autorisée doit surveiller le véhicule pour que Traccar signale sa sortie. Au mieux :
   * un échec (limite de zones du véhicule, Traccar indisponible) ne bloque pas le départ.
   */
  const ensureZoneWatch = async (request: FastifyRequest, zoneId: string, vehicleId: string): Promise<boolean> => {
    try {
      const [zone, vehicle, watched] = await Promise.all([
        prisma.zone.findFirst({ where: { id: zoneId, tenantId: tenantOf(request) }, select: { id: true, traccarGeofenceId: true } }),
        prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { traccarDeviceId: true, _count: { select: { zones: true } } } }),
        prisma.zoneVehicle.findUnique({ where: { zoneId_vehicleId: { zoneId, vehicleId } }, select: { zoneId: true } }),
      ]);
      if (!zone || !vehicle) return false;
      if (watched) return true;
      if (vehicle._count.zones >= ZONES_PER_VEHICLE) return false;
      await prisma.zoneVehicle.create({ data: { zoneId, vehicleId } });
      await traccar.linkGeofenceToDevice(vehicle.traccarDeviceId, zone.traccarGeofenceId);
      return true;
    } catch (err) {
      request.log.warn({ err }, "Zone autorisée non mise sous surveillance pour la location");
      return false;
    }
  };

  // ─── Départ ────────────────────────────────────────────────────────────────

  // Remise du véhicule : compteur et carburant, contrat PDF généré puis figé.
  app.post("/rentals/:id/pickup", { preHandler: writers }, async (request, reply) => {
    const rental = await findOwned(request);
    if (!rental) return reply.notFound();
    const parsed = handoverBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    if (rental.status !== "RESERVED") return conflict(reply, "RENTAL_NOT_RESERVED", "Le départ n'est possible que pour une réservation");
    if (!rental.vehicleId) return conflict(reply, "RENTAL_WITHOUT_VEHICLE", "Le véhicule de cette location a été retiré");
    const tenantId = tenantOf(request);
    const { odometerKm, fuelLevel } = parsed.data;
    const pickedUpAt = parsed.data.at ?? new Date();

    const earlier = await higherEarlierReading(rental.vehicleId, odometerKm, pickedUpAt);
    if (earlier) return conflict(reply, "ODOMETER_DECREASE", `Le compteur ne peut pas reculer : un relevé antérieur indique déjà ${earlier.km} km`);

    const [tenant, customer, vehicle] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: tenantPdfSelect }),
      prisma.customer.findUniqueOrThrow({ where: { id: rental.customerId } }),
      prisma.vehicle.findUniqueOrThrow({
        where: { id: rental.vehicleId },
        select: { name: true, plate: true, brand: true, model: true, year: true, vin: true, color: true },
      }),
    ]);

    // Le contrat est produit avant d'enregistrer le départ : pas de location partie sans contrat.
    const pdf = await generateContractPdf({
      reference: reference(rental.id),
      tenant,
      customer: {
        kind: customer.kind,
        name: customer.name,
        address: customer.address,
        phone: customer.phone,
        email: customer.email,
        birthDate: customer.birthDate,
        idDocumentLabel: ID_DOCUMENT_LABELS[customer.idDocumentType ?? "OTHER"]!,
        idDocumentNumber: customer.idDocumentEnc ? decryptField(customer.idDocumentEnc) : null,
        licenseNumber: customer.licenseNumberEnc ? decryptField(customer.licenseNumberEnc) : null,
        licenseExpiresOn: customer.licenseExpiresOn,
      },
      driverName: rental.driverName,
      vehicle,
      startAt: rental.startAt,
      endAt: rental.endAt,
      pickedUpAt,
      odometerOutKm: odometerKm,
      fuelOut: fuelLevel,
      price: rental.price?.toFixed(2) ?? null,
      deposit: rental.deposit?.toFixed(2) ?? null,
      terms: tenant.rentalTerms,
    });
    const fileName = await saveRentalFile(pdf, "pdf");

    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        // Deux départs simultanés : un seul passe de RESERVED à ONGOING.
        const moved = await tx.rental.updateMany({
          where: { id: rental.id, status: "RESERVED" },
          data: { status: "ONGOING", pickedUpAt, odometerOutKm: odometerKm, fuelOut: fuelLevel },
        });
        if (moved.count !== 1) return null;
        await tx.odometerReading.create({
          data: { tenantId, vehicleId: rental.vehicleId!, km: odometerKm, readAt: pickedUpAt, source: "RENTAL_OUT", rentalId: rental.id, createdBy: request.currentUser!.id },
        });
        await tx.rentalContract.create({ data: { tenantId, rentalId: rental.id, fileName, sha256: sha256(pdf), createdBy: request.currentUser!.id } });
        return tx.rental.findUniqueOrThrow({ where: { id: rental.id }, select: rentalSelect });
      });
    } catch (err) {
      await removeRentalFile(fileName);
      throw err;
    }
    if (!updated) {
      await removeRentalFile(fileName);
      return conflict(reply, "RENTAL_NOT_RESERVED", "Le départ de cette location vient d'être enregistré");
    }

    const zoneWatched = rental.allowedZoneId ? await ensureZoneWatch(request, rental.allowedZoneId, rental.vehicleId) : null;
    await audit(request, "rental.pickup", { tenantId, targetId: rental.id, details: { odometerKm, fuelLevel, pickedUpAt } });
    return { rental: publicRental(updated), contract: true, zoneWatched };
  });

  // ─── Retour ────────────────────────────────────────────────────────────────

  app.post("/rentals/:id/return", { preHandler: writers }, async (request, reply) => {
    const rental = await findOwned(request);
    if (!rental) return reply.notFound();
    const parsed = handoverBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    if (rental.status !== "ONGOING") return conflict(reply, "RENTAL_NOT_ONGOING", "Le retour n'est possible que pour une location en cours");
    const tenantId = tenantOf(request);
    const { odometerKm, fuelLevel } = parsed.data;
    const returnedAt = parsed.data.at ?? new Date();
    if (rental.pickedUpAt && returnedAt <= rental.pickedUpAt) return reply.badRequest("Le retour doit être après le départ");
    if (rental.odometerOutKm != null && odometerKm < rental.odometerOutKm) {
      return conflict(reply, "ODOMETER_DECREASE", `Le compteur ne peut pas reculer : il indiquait ${rental.odometerOutKm} km au départ`);
    }

    // Distance GPS entre le départ et le retour (au mieux : Traccar peut être indisponible).
    const vehicle = rental.vehicleId
      ? await prisma.vehicle.findUnique({ where: { id: rental.vehicleId }, select: { traccarDeviceId: true } })
      : null;
    const distance = vehicle && rental.pickedUpAt ? await gpsDistanceKm(vehicle.traccarDeviceId, rental.pickedUpAt, returnedAt, request.log) : null;

    const updated = await prisma.$transaction(async (tx) => {
      const moved = await tx.rental.updateMany({
        where: { id: rental.id, status: "ONGOING" },
        data: { status: "COMPLETED", returnedAt, odometerInKm: odometerKm, fuelIn: fuelLevel, gpsDistanceKm: distance },
      });
      if (moved.count !== 1) return null;
      if (rental.vehicleId) {
        await tx.odometerReading.create({
          data: { tenantId, vehicleId: rental.vehicleId, km: odometerKm, readAt: returnedAt, source: "RENTAL_IN", rentalId: rental.id, createdBy: request.currentUser!.id },
        });
      }
      return tx.rental.findUniqueOrThrow({ where: { id: rental.id }, select: rentalSelect });
    });
    if (!updated) return conflict(reply, "RENTAL_NOT_ONGOING", "Le retour de cette location vient d'être enregistré");

    await audit(request, "rental.return", { tenantId, targetId: rental.id, details: { odometerKm, fuelLevel, returnedAt, gpsDistanceKm: distance } });
    return { rental: publicRental(updated) };
  });

  // ─── Photos d'état des lieux ───────────────────────────────────────────────

  const photoSelect = { id: true, phase: true, caption: true, sizeBytes: true, createdAt: true } as const;

  app.get("/rentals/:id/photos", async (request, reply) => {
    const rental = await findOwned(request);
    if (!rental) return reply.notFound();
    const photos = await prisma.rentalPhoto.findMany({ where: { rentalId: rental.id }, select: photoSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return { photos, limitPerPhase: PHOTOS_PER_PHASE };
  });

  app.post("/rentals/:id/photos", { preHandler: writers, bodyLimit: 12_000_000 }, async (request, reply) => {
    const rental = await findOwned(request);
    if (!rental) return reply.notFound();
    const parsed = photoBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(parsed.error.issues[0]?.path[0] === "data" ? PHOTO_ERRORS.too_large : firstIssue(parsed.error));
    const { phase, caption } = parsed.data;
    if (rental.status === "CANCELLED" || (phase === "RETURN" && rental.status === "RESERVED")) {
      return conflict(reply, "RENTAL_PHOTO_PHASE", "Cette location n'accepte pas de photo à cette étape");
    }
    if ((await prisma.rentalPhoto.count({ where: { rentalId: rental.id, phase } })) >= PHOTOS_PER_PHASE) {
      return conflict(reply, "PHOTO_LIMIT", `${PHOTOS_PER_PHASE} photos au plus par étape`);
    }
    const decoded = decodePhoto(parsed.data.data);
    if ("error" in decoded) return reply.badRequest(PHOTO_ERRORS[decoded.error]);
    let bytes: Buffer;
    try {
      bytes = await normalizePhoto(decoded.bytes);
    } catch (err) {
      request.log.warn({ err }, "Photo de location illisible");
      return reply.badRequest(PHOTO_ERRORS.unreadable);
    }
    const fileName = await saveRentalFile(bytes, "jpg");
    let photo;
    try {
      photo = await prisma.rentalPhoto.create({
        data: { tenantId: tenantOf(request), rentalId: rental.id, phase, fileName, mimeType: "image/jpeg", sizeBytes: bytes.length, caption, createdBy: request.currentUser!.id },
        select: photoSelect,
      });
    } catch (err) {
      await removeRentalFile(fileName);
      throw err;
    }
    return reply.code(201).send({ photo });
  });

  const findPhoto = async (request: FastifyRequest) => {
    const rental = await findOwned(request);
    const photoId = id.safeParse((request.params as { photoId?: unknown }).photoId).data;
    if (!rental || !photoId) return null;
    return prisma.rentalPhoto.findFirst({ where: { id: photoId, rentalId: rental.id }, select: { id: true, fileName: true, mimeType: true, phase: true } });
  };

  app.get("/rentals/:id/photos/:photoId", async (request, reply) => {
    const photo = await findPhoto(request);
    if (!photo) return reply.notFound();
    try {
      return sendPrivateFile(reply, await readRentalFile(photo.fileName), photo.mimeType, `photo-${photo.id}.jpg`);
    } catch (err) {
      request.log.error({ err }, "Photo de location absente du disque");
      return reply.notFound();
    }
  });

  app.delete("/rentals/:id/photos/:photoId", { preHandler: adminOnly }, async (request, reply) => {
    const photo = await findPhoto(request);
    if (!photo) return reply.notFound();
    await prisma.rentalPhoto.delete({ where: { id: photo.id } });
    await removeRentalFile(photo.fileName);
    await audit(request, "rental.photo.delete", { tenantId: tenantOf(request), targetId: rentalIdOf(request), details: { photoId: photo.id, phase: photo.phase } });
    return reply.code(204).send();
  });

  // ─── Documents PDF ─────────────────────────────────────────────────────────

  // Contrat figé au départ : toujours le même fichier, jamais régénéré.
  app.get("/rentals/:id/contract.pdf", async (request, reply) => {
    const rental = await findOwned(request);
    const contract = rental ? await prisma.rentalContract.findUnique({ where: { rentalId: rental.id }, select: { fileName: true } }) : null;
    if (!rental || !contract) return reply.notFound();
    try {
      return sendPrivateFile(reply, await readRentalFile(contract.fileName), "application/pdf", `contrat-${reference(rental.id)}.pdf`);
    } catch (err) {
      request.log.error({ err }, "Contrat de location absent du disque");
      return reply.notFound();
    }
  });

  // Rapport de retour, généré à la demande une fois la location terminée.
  app.get("/rentals/:id/return-report.pdf", async (request, reply) => {
    const rental = await findOwned(request);
    if (!rental || rental.status !== "COMPLETED" || !rental.returnedAt) return reply.notFound();
    const [tenant, photos] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantOf(request) }, select: tenantPdfSelect }),
      prisma.rentalPhoto.findMany({ where: { rentalId: rental.id, phase: "RETURN" }, select: { fileName: true, caption: true }, orderBy: { createdAt: "asc" }, take: 12 }),
    ]);
    const loaded = await Promise.all(
      photos.map(async (p) => {
        try {
          return { bytes: await readRentalFile(p.fileName), caption: p.caption };
        } catch {
          return null;
        }
      }),
    );
    const pdf = await generateReturnReportPdf({
      reference: reference(rental.id),
      tenant,
      customerName: rental.customer.name,
      vehicle: { name: rental.vehicleName, plate: rental.vehiclePlate },
      startAt: rental.startAt,
      endAt: rental.endAt,
      pickedUpAt: rental.pickedUpAt,
      returnedAt: rental.returnedAt,
      odometerOutKm: rental.odometerOutKm,
      odometerInKm: rental.odometerInKm,
      fuelOut: rental.fuelOut,
      fuelIn: rental.fuelIn,
      gpsDistanceKm: rental.gpsDistanceKm,
      photos: loaded.filter((p) => p !== null),
    });
    return sendPrivateFile(reply, pdf, "application/pdf", `retour-${reference(rental.id)}.pdf`);
  });

  // ─── Conditions générales du loueur (reprises dans les contrats à venir) ────

  app.get("/tenant/rental-settings", async (request) => {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantOf(request) }, select: { rentalTerms: true } });
    return { rentalTerms: tenant.rentalTerms };
  });

  app.put("/tenant/rental-settings", { preHandler: adminOnly }, async (request, reply) => {
    const parsed = termsBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = tenantOf(request);
    await prisma.tenant.update({ where: { id: tenantId }, data: { rentalTerms: parsed.data.rentalTerms } });
    await audit(request, "rental.terms.update", { tenantId, targetId: tenantId, details: { length: parsed.data.rentalTerms?.length ?? 0 } });
    return { rentalTerms: parsed.data.rentalTerms };
  });
};

export default rentalOpsRoutes;
