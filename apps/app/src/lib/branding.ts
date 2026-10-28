// Branding du client, tel que l'admin client le saisira dans le back-office.
// Règle : chaque champ peut être absent, vide ou invalide, l'affichage doit toujours rester correct.
// Les champs marqués « BO futur » ne sont pas encore renvoyés par l'API : ils sont prévus ici
// pour que l'interface les prenne en compte sans refonte le jour où ils arrivent.

export interface BrandingInput {
  name?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  /** BO futur : site web de la société. */
  website?: string | null;
  /** BO futur : masquer la mention « Propulsé par AutoLocalize » (offre premium). */
  hidePoweredBy?: boolean | null;
}

export interface Branding {
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  /** Couleur du texte posé sur primaryColor (noir ou blanc selon le contraste). */
  onPrimary: string;
  /** primaryColor très atténuée, pour les fonds de sélection. */
  primarySoft: string;
  /** Initiales affichées quand il n'y a pas de logo (ou qu'il ne se charge pas). */
  initials: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  hidePoweredBy: boolean;
  /** true si c'est le branding par défaut de la plateforme (aucun client identifié). */
  isPlatform: boolean;
}

export const PLATFORM_NAME = "AutoLocalize";

const DEFAULT_PRIMARY = "#1E3A8A";
const DEFAULT_SECONDARY = "#F59E0B";

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(value: string | null | undefined, fallback: string): string {
  const v = value?.trim();
  if (!v || !HEX_COLOR.test(v)) return fallback;
  if (v.length === 4) {
    // #abc → #aabbcc
    return `#${[...v.slice(1)].map((c) => c + c).join("")}`.toUpperCase();
  }
  return v.toUpperCase();
}

function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

/** Luminance relative WCAG 2.x. */
function luminance(hex: string): number {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const c = channel(hex, i) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Noir ou blanc, celui qui contraste le mieux avec la couleur de fond. */
export function readableTextOn(hex: string): string {
  const l = luminance(hex);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastBlack = (l + 0.05) / 0.05;
  return contrastWhite >= contrastBlack ? "#FFFFFF" : "#0F172A";
}

export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** N'accepte que des URL http(s) ou relatives au serveur, pour éviter tout schéma exotique. */
function safeUrl(value: string | null | undefined): string | null {
  const v = clean(value);
  if (!v) return null;
  return /^(https?:\/\/|\/)/i.test(v) ? v : null;
}

function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.length >= 2 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function resolveBranding(input?: BrandingInput | null): Branding {
  const name = clean(input?.name);
  const primaryColor = normalizeHex(input?.primaryColor, DEFAULT_PRIMARY);
  const resolvedName = name ?? PLATFORM_NAME;

  return {
    name: resolvedName,
    logoUrl: safeUrl(input?.logoUrl),
    primaryColor,
    secondaryColor: normalizeHex(input?.secondaryColor, DEFAULT_SECONDARY),
    onPrimary: readableTextOn(primaryColor),
    primarySoft: withAlpha(primaryColor, 0.1),
    initials: initialsOf(resolvedName),
    address: clean(input?.address),
    phone: clean(input?.phone),
    email: clean(input?.email),
    website: safeUrl(input?.website),
    hidePoweredBy: input?.hidePoweredBy ?? false,
    isPlatform: !name,
  };
}

export const PLATFORM_BRANDING = resolveBranding(null);
