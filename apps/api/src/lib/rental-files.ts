import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config } from "../config.js";
import { sniffImage } from "./logos.js";

// Fichiers privés du module location : photos d'état des lieux et contrats PDF. Stockés hors de
// tout dossier public, sous un nom aléatoire généré ici ; servis seulement par des routes qui
// vérifient la session et le client propriétaire.

export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTOS_PER_PHASE = 30;
/** Plus grand côté d'une photo stockée, en pixels. */
const PHOTO_MAX_SIDE = 1920;
/** Noms générés par l'API : tout autre nom est refusé à la lecture (pas de traversée de chemin). */
const FILE_NAME = /^[a-f0-9]{32}\.(jpg|pdf)$/;

export function rentalFilesDir(): string {
  return resolve(config.RENTAL_FILES_DIR);
}

function pathOf(fileName: string): string {
  if (!FILE_NAME.test(fileName)) throw new Error("Nom de fichier de location invalide");
  return join(rentalFilesDir(), fileName);
}

export async function saveRentalFile(bytes: Buffer, ext: "jpg" | "pdf"): Promise<string> {
  const dir = rentalFilesDir();
  await mkdir(dir, { recursive: true });
  const fileName = `${randomBytes(16).toString("hex")}.${ext}`;
  await writeFile(join(dir, fileName), bytes, { flag: "wx", mode: 0o600 });
  return fileName;
}

export function readRentalFile(fileName: string): Promise<Buffer> {
  return readFile(pathOf(fileName));
}

export async function removeRentalFile(fileName: string): Promise<void> {
  await rm(pathOf(fileName), { force: true });
}

export const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export type PhotoError = "invalid" | "too_large" | "unsupported" | "unreadable";

export const PHOTO_ERRORS: Record<PhotoError, string> = {
  invalid: "Fichier illisible",
  too_large: "Photo trop lourde (8 Mo au maximum)",
  unsupported: "Format non pris en charge : JPEG, PNG ou WebP uniquement",
  unreadable: "Cette image n'a pas pu être lue",
};

/** Décode une photo envoyée en base64 et vérifie son type sur ses octets (jamais le type déclaré). */
export function decodePhoto(data: string): { bytes: Buffer } | { error: PhotoError } {
  const base64 = data.replace(/^data:[^;,]*;base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { error: "invalid" };
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) return { error: "invalid" };
  if (bytes.length > PHOTO_MAX_BYTES) return { error: "too_large" };
  if (!sniffImage(bytes)) return { error: "unsupported" };
  return { bytes };
}

/**
 * Photo prête à stocker : redressée selon son orientation, réduite à 1920 px au plus, réencodée en
 * JPEG. Le réencodage retire toutes les métadonnées EXIF, dont la position GPS du téléphone.
 * sharp est chargé à la demande : s'il ne se charge pas sur une plateforme, seul l'envoi de photos
 * est indisponible, pas l'API.
 */
export async function normalizePhoto(bytes: Buffer): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp(bytes, { failOn: "error" })
    .rotate()
    .resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}
