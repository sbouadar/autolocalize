import { useEffect, useMemo, useRef } from "react";
import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvent } from "react-leaflet";
import { useBranding } from "@/lib/branding-context";
import { MAP_ATTRIBUTION, MAP_TILE_URL } from "@/lib/config";
import { DEFAULT_REGION, DEFAULT_ZOOM, FOCUS_ZOOM, OVERVIEW_RADIUS_M, regionAround, type LatLng, type PositionedVehicle } from "@/lib/map";
import { vehicleLabel, vehicleStatus } from "@/lib/vehicles";
import type { VehicleMapProps } from "./vehicle-map-props";

// Le CSS de Leaflet est importé dans le layout racine (src/app/_layout.tsx), comme l'exige Expo Router.

function latLng(v: PositionedVehicle): [number, number] {
  return [v.position.latitude, v.position.longitude];
}

/** Coins (sud-ouest, nord-est) de la vue qui contient le cercle de ce rayon autour du point. */
function boundsAround(point: LatLng, radiusM: number): [[number, number], [number, number]] {
  const r = regionAround(point, radiusM);
  return [
    [r.latitude - r.latitudeDelta / 2, r.longitude - r.longitudeDelta / 2],
    [r.latitude + r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2],
  ];
}

/** Cadrage initial (flotte ou tracé), puis centrage à chaque changement de sélection. */
function Viewport({
  vehicles,
  selectedId,
  route,
  focus,
  overview,
}: Pick<VehicleMapProps, "vehicles" | "selectedId" | "route" | "focus" | "overview">) {
  const map = useMap();
  const fitted = useRef(false);
  const hasRoute = route != null && route.length > 1;

  // Une seule fois : les rafraîchissements périodiques ne doivent pas déplacer la carte.
  useEffect(() => {
    if (fitted.current || vehicles.length === 0 || hasRoute) return;
    fitted.current = true;
    if (overview) {
      // Vue d'ensemble : la flotte et ses environs, pour placer une zone sans avoir à dézoomer.
      const around = vehicles.flatMap((v) => boundsAround(v.position, OVERVIEW_RADIUS_M));
      map.fitBounds(around);
    } else if (vehicles.length === 1) map.setView(latLng(vehicles[0]!), FOCUS_ZOOM);
    else map.fitBounds(vehicles.map(latLng), { padding: [40, 40], maxZoom: FOCUS_ZOOM });
  }, [map, vehicles, hasRoute, overview]);

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

  useEffect(() => {
    if (!focus) return;
    fitted.current = true;
    if (focus.radiusM) map.flyToBounds(boundsAround(focus, focus.radiusM), { duration: 0.6 });
    else map.flyTo([focus.latitude, focus.longitude], Math.max(map.getZoom(), FOCUS_ZOOM - 1), { duration: 0.6 });
  }, [map, focus]);

  return null;
}

function BackgroundClick({ onSelect, onMapPress }: Pick<VehicleMapProps, "onSelect" | "onMapPress">) {
  useMapEvent("click", (e) => (onMapPress ? onMapPress({ latitude: e.latlng.lat, longitude: e.latlng.lng }) : onSelect(null)));
  return null;
}

/** Carte web (Leaflet + tuiles raster). */
export function VehicleMap({ vehicles, selectedId, onSelect, route, cursor, zones, onMapPress, focus, overview }: VehicleMapProps) {
  const branding = useBranding();
  const line = useMemo(() => route?.map((p): [number, number] => [p.latitude, p.longitude]), [route]);

  return (
    <MapContainer
      center={[DEFAULT_REGION.latitude, DEFAULT_REGION.longitude]}
      zoom={DEFAULT_ZOOM}
      style={{ position: "absolute", inset: 0 }}
    >
      <TileLayer url={MAP_TILE_URL} attribution={MAP_ATTRIBUTION} />
      <Viewport vehicles={vehicles} selectedId={selectedId} route={route} focus={focus} overview={overview} />
      <BackgroundClick onSelect={onSelect} onMapPress={onMapPress} />
      {zones?.map((z) => (
        // Non interactif : un clic dans une zone atteint le fond de carte ou le marqueur dessous.
        <Circle
          key={`${z.id}-${z.draft ? "draft" : "zone"}`}
          center={[z.latitude, z.longitude]}
          radius={z.radiusM}
          interactive={false}
          pathOptions={{
            color: z.color,
            weight: 2,
            dashArray: z.draft ? "6 6" : undefined,
            fillOpacity: z.draft ? 0.25 : 0.12,
          }}
        >
          <Tooltip direction="center" permanent opacity={0.9}>
            {z.name || "Nouvelle zone"}
          </Tooltip>
        </Circle>
      ))}
      {line && line.length > 1 ? (
        <Polyline positions={line} pathOptions={{ color: branding.primaryColor, weight: 4, opacity: 0.85 }} />
      ) : null}
      {cursor ? (
        <CircleMarker
          center={[cursor.latitude, cursor.longitude]}
          radius={9}
          interactive={false}
          pathOptions={{ color: "#FFFFFF", weight: 3, fillColor: branding.secondaryColor, fillOpacity: 1 }}
        />
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
