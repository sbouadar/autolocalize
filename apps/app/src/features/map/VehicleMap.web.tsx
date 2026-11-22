import { divIcon, type DivIcon } from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvent } from "react-leaflet";
import { useBranding } from "@/lib/branding-context";
import { colors } from "@/lib/theme";
import { MAP_ATTRIBUTION, MAP_TILE_URL } from "@/lib/config";
import { DEFAULT_REGION, DEFAULT_ZOOM, FOCUS_ZOOM, OVERVIEW_RADIUS_M, regionAround, type LatLng, type PositionedVehicle } from "@/lib/map";
import { vehicleLabel, vehicleState } from "@/lib/vehicles";
import { markerHtml, type MarkerLook } from "./marker-html";
import { speedRuns } from "@/lib/route-speed";
import type { VehicleMapProps } from "./vehicle-map-props";

// Le CSS de Leaflet est importé dans le layout racine (src/app/_layout.tsx), comme l'exige Expo Router.

function latLng(v: PositionedVehicle): [number, number] {
  return [v.position.latitude, v.position.longitude];
}

// Les positions se rafraîchissent toutes les 10 s : on réutilise l'icône tant que son aspect ne
// change pas, pour que Leaflet ne recrée pas l'élément (clignotement, survol perdu).
const iconCache = new Map<string, DivIcon>();
const ICON_CACHE_MAX = 500;

function vehicleIcon(look: MarkerLook): DivIcon {
  const key = JSON.stringify(look);
  let icon = iconCache.get(key);
  if (!icon) {
    if (iconCache.size >= ICON_CACHE_MAX) iconCache.clear();
    // Taille nulle : le HTML se positionne lui-même autour du point (voir marker-html.ts).
    icon = divIcon({ html: markerHtml(look), className: "", iconSize: [0, 0], iconAnchor: [0, 0] });
    iconCache.set(key, icon);
  }
  return icon;
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
    if (!selected) return;
    // Choisir un véhicule change la hauteur du panneau sous la carte, donc la taille de la carte :
    // on attend la fin de cette mise en page (deux images), puis on recentre par un simple
    // glissement (setView animé). flyTo dézoome et rezoome, ce qui faisait trembler l'image.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
        map.setView(latLng(selected), Math.max(map.getZoom(), FOCUS_ZOOM), { animate: true, duration: 0.4 });
      });
    });
    return () => cancelAnimationFrame(frame);
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

/**
 * Leaflet ne voit pas les changements de taille de son conteneur (panneau sous la carte qui grandit,
 * rotation de l'écran) : sans invalidateSize, la carte reste calée sur l'ancienne taille puis saute.
 */
function SizeWatcher() {
  const map = useMap();
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function BackgroundClick({ onSelect, onMapPress }: Pick<VehicleMapProps, "onSelect" | "onMapPress">) {
  useMapEvent("click", (e) => (onMapPress ? onMapPress({ latitude: e.latlng.lat, longitude: e.latlng.lng }) : onSelect(null)));
  return null;
}

/** Carte web (Leaflet + tuiles raster). */
export function VehicleMap({ vehicles, selectedId, onSelect, route, cursor, zones, onMapPress, focus, overview }: VehicleMapProps) {
  const branding = useBranding();
  // Tracé coloré selon la vitesse : une ligne par portion de même couleur.
  const runs = useMemo(() => (route ? speedRuns(route) : []), [route]);

  return (
    <MapContainer
      center={[DEFAULT_REGION.latitude, DEFAULT_REGION.longitude]}
      zoom={DEFAULT_ZOOM}
      style={{ position: "absolute", inset: 0 }}
    >
      <TileLayer url={MAP_TILE_URL} attribution={MAP_ATTRIBUTION} />
      <Viewport vehicles={vehicles} selectedId={selectedId} route={route} focus={focus} overview={overview} />
      <SizeWatcher />
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
      {runs.map((r, i) => (
        <Polyline
          key={i}
          positions={r.coordinates.map((p): [number, number] => [p.latitude, p.longitude])}
          pathOptions={{ color: r.color, weight: 4, opacity: 0.9 }}
        />
      ))}
      {cursor ? (
        <CircleMarker
          center={[cursor.latitude, cursor.longitude]}
          radius={9}
          interactive={false}
          pathOptions={{ color: colors.onDark, weight: 3, fillColor: branding.secondaryColor, fillOpacity: 1 }}
        />
      ) : null}
      {vehicles.map((v) => {
        const isSelected = v.id === selectedId;
        const state = vehicleState(v);
        const label = vehicleLabel(v);
        const icon = vehicleIcon({
          label,
          color: state.color,
          // Cap arrondi à 10° : inutile de recréer l'icône pour un degré d'écart.
          heading: state.key === "moving" ? Math.round(v.position.course / 10) * 10 : null,
          selected: isSelected,
          selectedBg: branding.primaryColor,
          selectedFg: branding.onPrimary,
          text: colors.text,
          surface: colors.surface,
        });
        return (
          <Marker
            key={v.id}
            position={latLng(v)}
            icon={icon}
            title={`${label}, ${state.label}`}
            alt={label}
            zIndexOffset={isSelected ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(v.id) }}
          />
        );
      })}
    </MapContainer>
  );
}
