// Fichiers CSV pour Excel en français : UTF-8 avec BOM, séparateur « ; », virgule décimale.

const SEPARATOR = ";";
const BOM = "﻿";

export type Cell = string | number | null | undefined;

/**
 * Valeur d'une cellule. Les textes qui commencent par = + - @ (ou une tabulation) sont préfixés
 * d'une apostrophe : Excel les exécuterait sinon comme une formule (injection de formule).
 */
export function csvCell(value: Cell): string {
  if (value == null) return "";
  let text = typeof value === "number" ? String(value).replace(".", ",") : value;
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(SEPARATOR));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** « 22/11/2026 14:05 » dans le fuseau du client. */
export function frenchDateTime(date: Date | null | undefined, timeZone: string): string | null {
  if (!date) return null;
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/** « 22/11/2026 » d'une date sans heure (AAAA-MM-JJ ou Date à minuit UTC). */
export function frenchDay(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const iso = typeof date === "string" ? date : date.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
