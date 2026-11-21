import { fonts, shadows } from "@/lib/theme";

// Marqueur de véhicule de la carte web (Leaflet) : pastille avec l'icône du véhicule sur la couleur
// de son état, une flèche de cap quand il roule, et son nom. Construit en HTML parce que Leaflet
// place des éléments du DOM, pas des composants React.

/** Icône « car » de Material Design Icons (licence Apache 2.0), la même que sur mobile. */
const CAR_PATH =
  "M5,11L6.5,6.5H17.5L19,11M17.5,16A1.5,1.5 0 0,1 16,14.5A1.5,1.5 0 0,1 17.5,13A1.5,1.5 0 0,1 19,14.5A1.5,1.5 0 0,1 17.5,16M6.5,16A1.5,1.5 0 0,1 5,14.5A1.5,1.5 0 0,1 6.5,13A1.5,1.5 0 0,1 8,14.5A1.5,1.5 0 0,1 6.5,16M18.92,6C18.72,5.42 18.16,5 17.5,5H6.5C5.84,5 5.28,5.42 5.08,6L3,12V20A1,1 0 0,0 4,21H5A1,1 0 0,0 6,20V19H18V20A1,1 0 0,0 19,21H20A1,1 0 0,0 21,20V12L18.92,6Z";

/** Distance entre le bord gauche de la pastille et le centre de l'icône : le point GPS est là. */
export const MARKER_ANCHOR_X = 20;

export interface MarkerLook {
  label: string;
  /** Couleur de l'état du véhicule. */
  color: string;
  /** Cap en degrés quand le véhicule roule, sinon null (pas de flèche). */
  heading: number | null;
  selected: boolean;
  /** Fond et texte de la pastille du véhicule sélectionné (couleur du client). */
  selectedBg: string;
  selectedFg: string;
  /** Texte et fond d'une pastille non sélectionnée. */
  text: string;
  surface: string;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Le nom vient de la base : il ne doit jamais être interprété comme du HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/** Seules les couleurs #RRGGBB sont acceptées dans le style ; sinon une couleur neutre. */
function safeColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#6B6B66";
}

export function markerHtml(look: MarkerLook): string {
  const color = safeColor(look.color);
  const bg = look.selected ? safeColor(look.selectedBg) : safeColor(look.surface);
  const fg = look.selected ? safeColor(look.selectedFg) : safeColor(look.text);
  const height = look.selected ? 40 : 36;
  const badge = look.selected ? 30 : 28;
  const heading =
    look.heading == null
      ? ""
      : `<span style="position:absolute;inset:-7px;transform:rotate(${Math.round(look.heading)}deg)">` +
        `<span style="position:absolute;top:0;left:50%;margin-left:-5px;width:0;height:0;` +
        `border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:7px solid ${color}"></span></span>`;
  return (
    `<div style="position:absolute;left:0;top:0;transform:translate(-${MARKER_ANCHOR_X}px,-50%);` +
    `display:inline-flex;align-items:center;gap:6px;height:${height}px;padding:0 12px 0 ${MARKER_ANCHOR_X - badge / 2}px;` +
    `border-radius:999px;background:${bg};color:${fg};box-shadow:${shadows.raised};white-space:nowrap;` +
    `font-family:${fonts.bold},system-ui,sans-serif;font-size:12px;line-height:1;cursor:pointer">` +
    `<span style="position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0;` +
    `width:${badge}px;height:${badge}px;border-radius:50%;background:${color}">${heading}` +
    `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="#FFFFFF" d="${CAR_PATH}"/></svg></span>` +
    `<span>${escapeHtml(look.label)}</span></div>`
  );
}
