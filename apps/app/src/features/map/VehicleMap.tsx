import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { speedRuns } from "@/lib/route-speed";
import { withAlpha } from "@/lib/branding";
import { useBranding } from "@/lib/branding-context";
import type { Branding } from "@/lib/branding";
import { focusRegion, OVERVIEW_RADIUS_M, regionAround, regionFor, type PositionedVehicle } from "@/lib/map";
import { colors, fonts, radius, shadows } from "@/lib/theme";
import { vehicleLabel, vehicleState } from "@/lib/vehicles";
import type { VehicleMapProps } from "./vehicle-map-props";

const EDGE_PADDING = { top: 60, right: 40, bottom: 60, left: 40 };

/**
 * Marqueur de véhicule : pastille avec l'icône du véhicule sur la couleur de son état, une flèche
 * de cap quand il roule, et son nom (même aspect que marker-html.ts sur le web).
 */
function VehicleMarker({
  vehicle,
  selected,
  branding,
  onPress,
}: {
  vehicle: PositionedVehicle;
  selected: boolean;
  branding: Branding;
  onPress: () => void;
}) {
  const state = vehicleState(vehicle);
  const label = vehicleLabel(vehicle);
  const heading = state.key === "moving" ? Math.round(vehicle.position.course / 10) * 10 : null;
  // Une vue personnalisée n'est redessinée que si tracksViewChanges est vrai, ce qui coûte cher :
  // on le laisse actif le temps du premier rendu (la clé du marqueur change avec son aspect).
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracking(false), 600);
    return () => clearTimeout(t);
  }, []);

  return (
    <Marker
      identifier={vehicle.id}
      coordinate={{ latitude: vehicle.position.latitude, longitude: vehicle.position.longitude }}
      anchor={{ x: 0, y: 0.5 }}
      zIndex={selected ? 1000 : 1}
      tracksViewChanges={tracking}
      stopPropagation
      onPress={onPress}
      accessibilityLabel={`${label}, ${state.label}`}
    >
      <View style={[styles.pill, selected && { backgroundColor: branding.primaryColor, height: 40 }]}>
        <View style={[styles.badge, { backgroundColor: state.color }]}>
          {heading != null ? (
            <View style={[styles.headingRing, { transform: [{ rotate: `${heading}deg` }] }]}>
              <View style={[styles.headingArrow, { borderBottomColor: state.color }]} />
            </View>
          ) : null}
          <MaterialCommunityIcons name="car" size={16} color={colors.onDark} />
        </View>
        <Text style={[styles.label, selected && { color: branding.onPrimary }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Marker>
  );
}

/** Carte native (Apple Maps sur iOS, Google Maps sur Android). */
export function VehicleMap({ vehicles, selectedId, onSelect, route, cursor, zones, onMapPress, focus, overview }: VehicleMapProps) {
  const branding = useBranding();
  const mapRef = useRef<MapView>(null);
  const fitted = useRef(false);
  const hasRoute = route != null && route.length > 1;
  // Tracé coloré selon la vitesse : une ligne par portion de même couleur.
  const runs = useMemo(() => (route ? speedRuns(route) : []), [route]);

  // Cadrage sur la flotte au premier chargement seulement : les rafraîchissements
  // périodiques ne doivent pas déplacer la carte sous les doigts de l'utilisateur.
  useEffect(() => {
    if (fitted.current || vehicles.length === 0 || hasRoute) return;
    fitted.current = true;
    // Vue d'ensemble (écran des zones) : large autour de la flotte, pour placer une zone sans dézoomer.
    if (overview) mapRef.current?.animateToRegion(regionAround(regionFor(vehicles.map((v) => v.position)), OVERVIEW_RADIUS_M));
    else if (vehicles.length === 1) mapRef.current?.animateToRegion(focusRegion(vehicles[0]!.position));
    else mapRef.current?.fitToCoordinates(vehicles.map((v) => v.position), { edgePadding: EDGE_PADDING, animated: true });
  }, [vehicles, hasRoute, overview]);

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

  // Centrage sur la zone choisie dans la liste.
  useEffect(() => {
    if (!focus) return;
    fitted.current = true;
    mapRef.current?.animateToRegion(focus.radiusM ? regionAround(focus, focus.radiusM) : focusRegion(focus), 400);
  }, [focus]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={regionFor(hasRoute ? route : vehicles.map((v) => v.position))}
      onPress={(e) => (onMapPress ? onMapPress(e.nativeEvent.coordinate) : onSelect(null))}
      toolbarEnabled={false}
    >
      {zones?.map((z) => (
        <Circle
          key={`${z.id}-${z.draft ? "draft" : "zone"}`}
          center={{ latitude: z.latitude, longitude: z.longitude }}
          radius={z.radiusM}
          strokeWidth={2}
          strokeColor={z.color}
          fillColor={withAlpha(z.color, z.draft ? 0.25 : 0.12)}
        />
      ))}
      {runs.map((r, i) => (
        <Polyline key={i} coordinates={r.coordinates} strokeColor={r.color} strokeWidth={4} />
      ))}
      {cursor ? <Marker coordinate={cursor} pinColor={branding.secondaryColor} title="Replay" tracksViewChanges={false} /> : null}
      {vehicles.map((v) => {
        const selected = v.id === selectedId;
        const state = vehicleState(v);
        const heading = state.key === "moving" ? Math.round(v.position.course / 10) : "";
        return (
          <VehicleMarker
            // Nouvelle clé à chaque changement d'aspect : le marqueur se redessine (voir tracksViewChanges).
            key={`${v.id}|${state.key}|${heading}|${selected}|${vehicleLabel(v)}|${branding.primaryColor}`}
            vehicle={v}
            selected={selected}
            branding={branding}
            onPress={() => onSelect(v.id)}
          />
        );
      })}
    </MapView>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingLeft: 4,
    paddingRight: 12,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    boxShadow: shadows.raised,
  },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headingRing: { position: "absolute", top: -7, left: -7, right: -7, bottom: -7, alignItems: "center" },
  headingArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  label: { fontFamily: fonts.bold, fontSize: 12, color: colors.text, maxWidth: 140 },
});
