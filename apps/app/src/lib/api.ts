import { Platform } from "react-native";
import type { ZodType } from "zod";
import { API_URL } from "./config";
import { STORAGE_KEYS, storage } from "./storage";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Natif : Better Auth (plugin bearer) renvoie le jeton dans l'en-tête set-auth-token,
// qu'on renvoie ensuite en Authorization. Web : cookie de session, rien à gérer.
let tokenCache: string | null | undefined;

async function getToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (tokenCache === undefined) tokenCache = await storage.get(STORAGE_KEYS.sessionToken);
  return tokenCache;
}

export async function setSessionToken(token: string | null): Promise<void> {
  if (Platform.OS === "web") return;
  tokenCache = token;
  if (token) await storage.set(STORAGE_KEYS.sessionToken, token);
  else await storage.remove(STORAGE_KEYS.sessionToken);
}

type Unauthorized = () => void;
let onUnauthorized: Unauthorized | null = null;

/** Appelé sur toute réponse 401 hors connexion : session expirée ou révoquée. */
export function setUnauthorizedHandler(handler: Unauthorized | null) {
  onUnauthorized = handler;
}

export interface ApiOptions<T> {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Schéma de validation de la réponse : une réponse non conforme est traitée comme une erreur. */
  schema?: ZodType<T>;
}

export async function api<T>(path: string, options: ApiOptions<T> = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      // Web : cookie de session de même origine. Natif : jeton uniquement, jamais de cookie
      // (Better Auth exigerait alors un en-tête Origin que les applications natives n'envoient pas).
      credentials: Platform.OS === "web" ? "include" : "omit",
    });
  } catch {
    throw new ApiError(0, "Serveur injoignable. Vérifiez votre connexion.");
  }

  const authToken = res.headers.get("set-auth-token");
  if (authToken) await setSessionToken(authToken);

  if (!res.ok) {
    let message = `Erreur ${res.status}`;
    let code: string | undefined;
    try {
      const data = (await res.json()) as { message?: string; error?: string; code?: string };
      message = data.message ?? data.error ?? message;
      code = data.code;
    } catch {
      // corps non JSON
    }
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new ApiError(res.status, message, code);
  }

  if (res.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    // Typiquement une page HTML : l'URL de l'API est mal configurée (EXPO_PUBLIC_API_URL en dev).
    throw new ApiError(0, "Le serveur a renvoyé une réponse illisible. Vérifiez l'adresse de l'API.");
  }
  if (!options.schema) return data as T;

  const parsed = options.schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(0, "Réponse inattendue du serveur. Mettez l'application à jour ou réessayez.");
  }
  return parsed.data;
}

/**
 * Formulaires de notre API (back-office, branding) : pour une erreur de saisie (400, 404, 409),
 * le message est rédigé par l'API à l'intention de l'utilisateur ; sinon, message générique.
 */
export function formMessage(err: unknown): string {
  if (err instanceof ApiError && [400, 404, 409].includes(err.status) && err.message && !/^Erreur \d+$/.test(err.message)) {
    return err.message;
  }
  return userMessage(err);
}

/** Message à afficher à l'utilisateur : jamais le texte brut du serveur pour les erreurs techniques. */
export function userMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Une erreur inattendue est survenue.";
  if (err.status === 0) return err.message; // messages rédigés par l'application
  if (err.status === 401) return "Votre session a expiré. Reconnectez-vous.";
  if (err.status === 403) return err.message || "Accès refusé.";
  if (err.status === 404) return "Élément introuvable.";
  if (err.status === 429) return "Trop de tentatives. Patientez une minute avant de réessayer.";
  if (err.status >= 500) return "Le service est momentanément indisponible. Réessayez dans quelques instants.";
  return "La requête n'a pas pu aboutir.";
}
