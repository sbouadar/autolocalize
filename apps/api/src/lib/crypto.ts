import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { config } from "../config.js";

// Protection des numéros de pièce d'identité et de permis des locataires.
// - Chiffrement AES-256-GCM, IV aléatoire par valeur, format « v1:<iv>:<tag>:<texte chiffré> » en
//   base64. Le préfixe de version permettra une rotation de clé.
// - Empreinte HMAC-SHA-256 du numéro normalisé, avec une seconde clé : recherche exacte et détection
//   de doublons sans rien déchiffrer.
// Les clés viennent du .env (DATA_ENCRYPTION_KEY, DATA_HASH_KEY), jamais de la base.

const VERSION = "v1";

/** Les deux clés sont configurées : condition pour activer le module location. */
export function dataKeysConfigured(): boolean {
  return Boolean(config.DATA_ENCRYPTION_KEY && config.DATA_HASH_KEY);
}

function key(name: "DATA_ENCRYPTION_KEY" | "DATA_HASH_KEY"): Buffer {
  const value = config[name];
  if (!value) throw new Error(`${name} n'est pas configurée`);
  return Buffer.from(value, "base64");
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("DATA_ENCRYPTION_KEY"), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}

/** Déchiffre une valeur ; lève une erreur si elle a été altérée ou chiffrée avec une autre clé. */
export function decryptField(stored: string): string {
  const [version, iv, tag, encrypted] = stored.split(":");
  if (version !== VERSION || !iv || !tag || encrypted === undefined) throw new Error("Valeur chiffrée illisible");
  const decipher = createDecipheriv("aes-256-gcm", key("DATA_ENCRYPTION_KEY"), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}

/** Majuscules, sans espaces, tirets ni points : « ab 123-456 » et « AB123456 » sont le même numéro. */
export function normalizeIdentifier(value: string): string {
  return value.toUpperCase().replace(/[\s\-._/]/g, "");
}

/** Empreinte du numéro normalisé (64 caractères hexadécimaux). */
export function hashIdentifier(value: string): string {
  return createHmac("sha256", key("DATA_HASH_KEY")).update(normalizeIdentifier(value)).digest("hex");
}

/** 4 derniers caractères du numéro normalisé, pour l'affichage masqué (« ••••1234 »). */
export function last4(value: string): string {
  return normalizeIdentifier(value).slice(-4);
}
