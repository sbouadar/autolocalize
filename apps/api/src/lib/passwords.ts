import { hashPassword } from "better-auth/crypto";
import { randomInt } from "node:crypto";
import { prisma } from "./prisma.js";

// Sans caractères ambigus (0/O, 1/l/I) : le mot de passe est recopié à la main par le client.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 16; // ≈ 93 bits d'entropie

/** Mot de passe provisoire tiré au hasard (générateur cryptographique). */
export function generateTemporaryPassword(): string {
  let password = "";
  for (let i = 0; i < LENGTH; i++) password += ALPHABET[randomInt(ALPHABET.length)];
  return password;
}

/**
 * Remplace le mot de passe d'un compte par un mot de passe provisoire, à changer à la
 * prochaine connexion, et ferme toutes ses sessions. Renvoie le mot de passe en clair :
 * il n'est affiché qu'une fois au super-admin et n'est jamais stocké ni journalisé.
 */
export async function resetToTemporaryPassword(userId: string): Promise<string> {
  const password = generateTemporaryPassword();
  const hash = await hashPassword(password);
  await prisma.$transaction([
    prisma.account.updateMany({ where: { userId, providerId: "credential" }, data: { password: hash } }),
    prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  return password;
}
