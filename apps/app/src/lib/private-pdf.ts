import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { apiUrl, authHeaders } from "./api";

/** Délai avant d'effacer la copie locale : le temps que l'application choisie ait lu le fichier. */
const CLEANUP_DELAY_MS = 5 * 60_000;

/**
 * Mobile : télécharge un PDF privé de l'API avec le jeton de session, puis l'ouvre dans le menu de
 * partage du téléphone (aperçu, impression, envoi). La copie locale contient des données
 * personnelles (pièce d'identité du locataire) : elle est effacée quelques minutes après.
 */
export async function openPrivatePdf(path: string, fileName: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  const downloaded = await File.downloadFileAsync(apiUrl(path), file, { headers: await authHeaders(), idempotent: true });
  setTimeout(() => {
    try {
      if (downloaded.exists) downloaded.delete();
    } catch {
      // Copie déjà effacée (cache vidé par le système) : rien à faire.
    }
  }, CLEANUP_DELAY_MS);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Aucune application ne peut ouvrir ce document sur ce téléphone.");
  await Sharing.shareAsync(downloaded.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: fileName });
}
