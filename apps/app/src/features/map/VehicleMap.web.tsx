import { useEffect, useMemo, useRef } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvent } from "react-leaflet";
import { useBranding } from "@/lib/branding-context";
import { MAP_ATTRIBUTION, MAP_TILE_URL } from "@/lib/config";
import { DEFAULT_REGION, DEFAULT_ZOOM, FOCUS_ZOOM, type PositionedVehicle } from "@/lib/map";
import { vehicleLabel, vehicleStatus } from "@/lib/vehicles";
import type { VehicleMapProps } from "./vehicle-map-props";

// Le CSS de Leaflet est importé dans le layout racine (src/app/_layout.tsx), comme l'exige Expo Router.

function latLng(v: PositionedVehicle): [number, number] {
  return [v.position.latitude, v.position.longitude];
}

/** Cadrage initial (flotte ou tracé), puis centrage à chaque changement de sélection. */
function Viewport({ vehicles, selectedId, route }: Pick<VehicleMapProps, "vehicles" | "selectedId" | "route">) {
  const map = useMap();
  const fitted = useRef(false);
  const hasRoute = route != null && route.length > 1;

  // Une seule fois : les rafraîchissements périodiques ne doivent pas déplacer la carte.
  useEffect(() => {
    if (fitted.current || vehicles.length === 0 || hasRoute) return;
    fitted.current = true;
    if (vehicles.length === 1) map.setView(latLng(vehicles[0]!), FOCUS_ZOOM);
    else map.fitBounds(vehicles.map(latLng), { padding: [40, 40], maxZoom: FOCUS_ZOOM });
  }, [map, vehicles, hasRoute]);

  // Historique : recadrage sur le tracé à chaque nouveau tracé.
  useEffect(() => {
    if (!route || route.length < 2) return;
    fitted.current = true;
    map.fitBounds(
      route.map((p) => [p.latitude, p.longitude]),
      { padding: [30, 30], maxZoom: FOCUS_ZOOM },
    );
  }, [map, route]);

  const selected = vehicles.find((v) => v.id === selectedId);
  useEffect(() => {
    if (selected) map.flyTo(latLng(selected), Math.max(map.getZoom(), FOCUS_ZOOM), { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedId]);

  return null;
}

function BackgroundClick({ onSelect }: Pick<VehicleMapProps, "onSelect">) {
  useMapEvent("click", () => onSelect(null));
  return null;
}

/** Carte web (Leaflet + tuiles raster). */
export function VehicleMap({ vehicles, selectedId, onSelect, route }: VehicleMapProps) {
  const branding = useBranding();
  const line = useMemo(() => route?.map((p): [number, number] => [p.latitude, p.longitude]), [route]);

  return (
    <MapContainer
      center={[DEFAULT_REGION.latitude, DEFAULT_REGION.longitude]}
      zoom={DEFAULT_ZOOM}
      style={{ position: "absolute", inset: 0 }}
    >
      <TileLayer url={MAP_TILE_URL} attribution={MAP_ATTRIBUTION} />
      <Viewport vehicles={vehicles} selectedId={selectedId} route={route} />
      <BackgroundClick onSelect={onSelect} />
      {line && line.length > 1 ? (
        <Polyline positions={line} pathOptions={{ color: branding.primaryColor, weight: 4, opacity: 0.85 }} />
      ) : null}
      {vehicles.map((v) => {
        const isSelected = v.id === selectedId;
        return (
          <CircleMarker
            key={v.id}
            center={latLng(v)}
            radius={isSelected ? 11 : 8}
            bubblingMouseEvents={false}
            pathOptions={{
              color: isSelected ? branding.primaryColor : "#FFFFFF",
              weight: isSelected ? 4 : 2,
              fillColor: vehicleStatus(v).color,
              fillOpacity: 1,
            }}
            eventHandlers={{ click: () => onSelect(v.id) }}
          >
            {/* « permanent » n'est lu qu'à la création : la clé force une nouvelle info-bulle. */}
            <Tooltip key={String(isSelected)} direction="top" offset={[0, -10]} permanent={isSelected}>
              {vehicleLabel(v)}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
