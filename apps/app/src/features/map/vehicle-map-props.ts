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
  /** Zones du client, dessinées en cercles ; draft : zone en cours de création ou de modification. */
  zones?: MapZone[];
  /** Appui sur le fond de carte : choix du centre d'une zone. Remplace alors la désélection. */
  onMapPress?: (point: LatLng) => void;
  /**
   * Point sur lequel recadrer la carte, à chaque nouvel objet. Avec radiusM, la carte montre tout
   * le cercle de ce rayon (zone choisie dans la liste, vue d'ensemble avant de créer une zone).
   */
  focus?: (LatLng & { radiusM?: number }) | null;
  /** Vue d'ensemble au premier cadrage, au lieu d'un zoom serré sur les véhicules (écran des zones). */
  overview?: boolean;
  /** Position du replay : marqueur qui se déplace sur le tracé (sans recadrer la carte). */
  cursor?: LatLng | null;
}

export interface MapZone extends LatLng {
  id: string;
  name: string;
  radiusM: number;
  /** Couleur du cercle (#RRGGBB). */
  color: string;
  draft?: boolean;
}
