// Jetons de style de l'interface. Les couleurs de marque viennent du branding du client
// (lib/branding.ts) ; ici, uniquement les neutres, les états et les échelles communes.

export const colors = {
  /** Fond des écrans. */
  background: "#FFFFFF",
  /** Fond des éléments posés sur un aplat (champs, boutons secondaires, panneaux flottants). */
  surface: "#FFFFFF",
  /** Aplat gris chaud des tuiles et des blocs : remplace les cartes à bordure. */
  fill: "#F4F4F1",
  /** Noir adouci : texte, et couleur par défaut de la plateforme. */
  text: "#141414",
  muted: "#5C5C58",
  border: "#E7E7E3",
  onDark: "#FFFFFF",
  danger: "#B42318",
  dangerSoft: "#FDECEA",
  warning: "#B45309",
  warningSoft: "#FDF3E3",
  online: "#0E7A43",
  onlineSoft: "#E3F2E8",
  offline: "#6B6B66",
  unknown: "#B45309",
} as const;

export const radius = { sm: 8, md: 14, lg: 16, xl: 20, full: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/**
 * Police Manrope, un fichier par graisse (chargés dans app/_layout.tsx). Toujours passer par
 * `fontFamily` et jamais par `fontWeight` : avec des fichiers statiques, `fontWeight` fait
 * simuler la graisse par le système (ou retomber sur la police système).
 */
export const fonts = {
  /** Texte courant. */
  regular: "Manrope_500Medium",
  /** Libellés et texte secondaire appuyé. */
  medium: "Manrope_600SemiBold",
  /** Boutons, onglets, valeurs dans une liste. */
  bold: "Manrope_700Bold",
  /** Titres et chiffres clés. */
  heavy: "Manrope_800ExtraBold",
} as const;

/** Ombres des éléments flottants (au-dessus de la carte surtout). */
export const shadows = {
  raised: "0 2px 10px rgba(20, 20, 20, 0.14)",
  overlay: "0 6px 24px rgba(20, 20, 20, 0.14)",
} as const;
