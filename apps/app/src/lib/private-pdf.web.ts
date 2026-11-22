import { Linking } from "react-native";
import { apiUrl } from "./api";

/** Web : le cookie de session de même origine suffit, le PDF s'ouvre dans un nouvel onglet. */
export async function openPrivatePdf(path: string, _fileName: string): Promise<void> {
  await Linking.openURL(apiUrl(path));
}
