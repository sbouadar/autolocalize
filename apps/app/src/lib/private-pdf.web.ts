import { Linking } from "react-native";
import { apiUrl } from "./api";

/** Web : le cookie de session de même origine suffit ; un PDF s'ouvre dans un onglet, un CSV se télécharge. */
export async function openPrivateFile(path: string, _fileName: string, _mimeType?: string, _uti?: string): Promise<void> {
  await Linking.openURL(apiUrl(path));
}

export const openPrivatePdf = (path: string, fileName: string) => openPrivateFile(path, fileName);
export const openPrivateCsv = (path: string, fileName: string) => openPrivateFile(path, fileName);
