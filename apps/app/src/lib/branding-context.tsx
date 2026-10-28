import { createContext, useContext, type ReactNode } from "react";
import { PLATFORM_BRANDING, type Branding } from "./branding";

const BrandingContext = createContext<Branding>(PLATFORM_BRANDING);

export function BrandingProvider({ value, children }: { value: Branding; children: ReactNode }) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

/** Branding du client courant ; celui de la plateforme si aucun client n'est identifié. */
export function useBranding(): Branding {
  return useContext(BrandingContext);
}
