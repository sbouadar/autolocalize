import type { LatLng, PositionedVehicle } from "@/lib/map";

/** Contrat commun aux deux cartes : VehicleMap.tsx (natif) et VehicleMap.web.tsx (Leaflet). */
export interface VehicleMapProps {
  vehicles: PositionedVehicle[];
  selectedId: string | null;
  /** Clic sur un marqueur (id) ou sur le fond de carte (null). */
  onSelect: (id: string | null) => void;
  /**
   * Tracé à dessiner (historique). La carte se recadre dessus à chaque nouveau tableau :
   * le passer mémoïsé pour ne pas recadrer à chaque rendu.
   */
  route?: LatLng[];
}
