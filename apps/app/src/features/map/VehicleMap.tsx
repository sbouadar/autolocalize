import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { useBranding } from "@/lib/branding-context";
import { focusRegion, regionFor } from "@/lib/map";
import { movementLabel, vehicleLabel, vehicleStatus } from "@/lib/vehicles";
import type { VehicleMapProps } from "./vehicle-map-props";

const EDGE_PADDING = { top: 60, right: 40, bottom: 60, left: 40 };

/** Carte native (Apple Maps sur iOS, Google Maps sur Android). */
export function VehicleMap({ vehicles, selectedId, onSelect, route, cursor }: VehicleMapProps) {
  const branding = useBranding();
  const mapRef = useRef<MapView>(null);
  const fitted = useRef(false);
  const hasRoute = route != null && route.length > 1;

  // Cadrage sur la flotte au premier chargement seulement : les rafraîchissements
  // périodiques ne doivent pas déplacer la carte sous les doigts de l'utilisateur.
  useEffect(() => {
    if (fitted.current || vehicles.length === 0 || hasRoute) return;
    fitted.current = true;
    if (vehicles.length === 1) mapRef.current?.animateToRegion(focusRegion(vehicles[0]!.position));
    else mapRef.current?.fitToCoordinates(vehicles.map((v) => v.position), { edgePadding: EDGE_PADDING, animated: true });
  }, [vehicles, hasRoute]);

  // Historique : recadrage sur le tracé à chaque nouveau tracé.
  useEffect(() => {
    if (route && route.length > 1) {
      fitted.current = true;
      mapRef.current?.fitToCoordinates(route, { edgePadding: EDGE_PADDING, animated: true });
    }
  }, [route]);

  // Centrage sur le véhicule choisi, uniquement quand la sélection change (pas à chaque position).
  const selected = vehicles.find((v) => v.id === selectedId);
  useEffect(() => {
    if (selected) mapRef.current?.animateToRegion(focusRegion(selected.position), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={regionFor(hasRoute ? route : vehicles.map((v) => v.position))}
      onPress={() => onSelect(null)}
      toolbarEnabled={false}
    >
      {hasRoute ? <Polyline coordinates={route} strokeColor={branding.primaryColor} strokeWidth={4} /> : null}
      {cursor ? <Marker coordinate={cursor} pinColor={branding.secondaryColor} title="Replay" tracksViewChanges={false} /> : null}
      {vehicles.map((v) => (
        <Marker
          key={v.id}
          identifier={v.id}
          coordinate={{ latitude: v.position.latitude, longitude: v.position.longitude }}
          pinColor={vehicleStatus(v).color}
          title={vehicleLabel(v)}
          description={movementLabel(v.position)}
          stopPropagation
          onPress={() => onSelect(v.id)}
        />
      ))}
    </MapView>
  );
}
