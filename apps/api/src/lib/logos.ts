import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "./prisma.js";

// Logos des clients : PNG, JPEG ou WebP uniquement (pas de SVG, qui peut embarquer du script),
// 512 Ko au plus. Le type est déduit des octets du fichier, jamais du type déclaré.
export const LOGO_MAX_BYTES = 512 * 1024;
export const LOGO_URL_PREFIX = "/api/public/logos/";
/** Noms générés par l'API : tout autre nom est refusé au téléchargement (pas de traversée). */
export const LOGO_FILE = /^[a-f0-9]{32}\.(png|jpg|webp)$/;

export const logoBody = z.object({
  // base64 « pur » ou data URL ; la taille réelle est contrôlée après décodage.
  data: z.string().min(1).max(Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 100),
});

type ImageType = { ext: "png" | "jpg" | "webp"; mime: string };

/** Type d'image d'après sa signature binaire (« magic bytes »). */
export function sniffImage(bytes: Buffer): ImageType | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", mime: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

export const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export function logoDir(): string {
  return resolve(config.LOGO_DIR);
}

export type LogoError = "invalid" | "too_large" | "unsupported";

/** Décode et vérifie un logo envoyé en base64. */
export function decodeLogo(data: string): { bytes: Buffer; type: ImageType } | { error: LogoError } {
  const base64 = data.replace(/^data:[^;,]*;base64,/, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { error: "invalid" };
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) return { error: "invalid" };
  if (bytes.length > LOGO_MAX_BYTES) return { error: "too_large" };
  const type = sniffImage(bytes);
  if (!type) return { error: "unsupported" };
  return { bytes, type };
}

function fileOf(logoUrl: string | null): string | null {
  if (!logoUrl?.startsWith(LOGO_URL_PREFIX)) return null;
  const file = logoUrl.slice(LOGO_URL_PREFIX.length);
  return LOGO_FILE.test(file) ? file : null;
}

/** Enregistre le nouveau logo sous un nom aléatoire, met à jour le client et supprime l'ancien. */
export async function replaceLogo(tenantId: string, bytes: Buffer, ext: string): Promise<string> {
  const dir = logoDir();
  await mkdir(dir, { recursive: true });
  const file = `${randomBytes(16).toString("hex")}.${ext}`;
  await writeFile(join(dir, file), bytes, { flag: "wx" });

  const previous = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { logoUrl: true } });
  const logoUrl = `${LOGO_URL_PREFIX}${file}`;
  await prisma.tenant.update({ where: { id: tenantId }, data: { logoUrl } });
  await removeLogoFile(previous?.logoUrl ?? null);
  return logoUrl;
}

export async function clearLogo(tenantId: string) {
  const previous = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { logoUrl: true } });
  await prisma.tenant.update({ where: { id: tenantId }, data: { logoUrl: null } });
  await removeLogoFile(previous?.logoUrl ?? null);
}

async function removeLogoFile(logoUrl: string | null) {
  const file = fileOf(logoUrl);
  if (file) await rm(join(logoDir(), file), { force: true });
}

export const LOGO_ERRORS: Record<LogoError, string> = {
  invalid: "Fichier illisible",
  too_large: "Logo trop lourd (512 Ko au maximum)",
  unsupported: "Format non pris en charge : PNG, JPEG ou WebP uniquement",
};
