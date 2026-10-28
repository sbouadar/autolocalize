const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dayTime = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** « 08:30 » ; avec le jour (« lun. 27 08:30 ») si demandé. */
export function formatTime(iso: string | null | undefined, withDay = false): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return (withDay ? dayTime : time).format(t);
}

/** « 25 min », « 1 h 05 », « 0 min ». */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `${h} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** « 12,3 km » */
export function formatDistance(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return "—";
  return `${decimal.format(km)} km`;
}

/** « il y a 5 minutes », « hier »… ; « jamais » si pas de date. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "jamais";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "date inconnue";

  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "à l'instant";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 30 * 86_400) return rtf.format(Math.round(seconds / 86_400), "day");
  return dateTime.format(time);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const time = Date.parse(iso);
  return Number.isNaN(time) ? "—" : dateTime.format(time);
}

export function formatSpeed(kmh: number | null | undefined): string {
  if (kmh == null) return "—";
  return `${Math.round(kmh)} km/h`;
}

export function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
