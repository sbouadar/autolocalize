import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

// Notifications push des alertes (mobile). Nécessite un projet EAS (extra.eas.projectId dans
// app.json) : sans lui, Expo ne délivre pas de jeton et l'inscription est simplement sautée.

let registeredToken: string | null = null;

/** Notifications affichées même quand l'app est ouverte. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

/**
 * Demande l'autorisation (une fois), obtient le jeton Expo de l'appareil et le donne à l'API.
 * Renvoie le jeton, ou null si les notifications sont refusées ou indisponibles.
 */
export async function registerForPush(): Promise<string | null> {
  const projectId = easProjectId();
  if (!projectId) return null;
  if (Platform.OS === "android") {
    // AndroidImportance est un enum déclaré dans un .d.ts : la règle import/namespace ne le voit pas.
    // eslint-disable-next-line import/namespace
    await Notifications.setNotificationChannelAsync("alerts", { name: "Alertes", importance: Notifications.AndroidImportance.HIGH });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return null;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api("/me/push-tokens", { method: "POST", body: { token, platform: Platform.OS === "ios" ? "IOS" : "ANDROID" } });
  registeredToken = token;
  return token;
}

/** À la déconnexion : l'appareil ne doit plus recevoir les alertes de ce compte. */
export async function unregisterPush(): Promise<void> {
  if (!registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  try {
    await api("/me/push-tokens/remove", { method: "POST", body: { token } });
  } catch {
    // Hors ligne : le jeton sera réattribué ou oublié par l'API plus tard.
  }
}

/** Appui sur une notification : ouvre l'onglet des alertes. */
export function onNotificationOpened(open: () => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(() => open());
  return () => sub.remove();
}
