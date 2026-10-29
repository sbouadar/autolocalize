import type { FastifyBaseLogger } from "fastify";
import { traccar } from "./traccar.js";

// Adresses des quelques points affichés (premier départ et dernière arrivée d'une période), obtenues
// par le géocodeur de Traccar et gardées en mémoire. Traccar ne géocode plus les trajets de ses
// rapports (geocoder.onRequest=false) : Nominatim public, à 1 requête par seconde, les rendait
// beaucoup trop lents.

const MAX_ENTRIES = 5_000;
/** Délai d'attente d'une adresse par la route : au-delà, on répond sans, la recherche continue. */
const WAIT_MS = 3_000;

const cache = new Map<string, Promise<string | null>>();

/** Coordonnées arrondies à 4 décimales (environ 10 m) : un même stationnement partage son adresse. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

function lookup(latitude: number, longitude: number, log: FastifyBaseLogger): Promise<string | null> {
  const key = `${round4(latitude)},${round4(longitude)}`;
  const cached = cache.get(key);
  if (cached) {
    // Remis en fin de Map : les entrées les moins récemment utilisées sont évincées en premier.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const pending = traccar.reverseGeocode(round4(latitude), round4(longitude)).catch((err: unknown) => {
    log.warn({ err }, "Échec du géocodage Traccar");
    return null;
  });
  // Un échec ou une absence d'adresse n'est pas gardé : on retentera à la prochaine consultation.
  void pending.then((address) => {
    if (address === null && cache.get(key) === pending) cache.delete(key);
  });
  cache.set(key, pending);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return pending;
}

/** Adresse du point, ou null si elle n'est pas connue à temps (la recherche continue en arrière-plan). */
export async function addressOf(latitude: number, longitude: number, log: FastifyBaseLogger): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), WAIT_MS);
  });
  try {
    return await Promise.race([lookup(latitude, longitude, log), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Vide le cache (tests). */
export function resetAddressCache() {
  cache.clear();
}
