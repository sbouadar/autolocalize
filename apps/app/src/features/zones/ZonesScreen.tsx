import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorState, LoadingState } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage, userMessage } from "@/lib/api";
import { useBranding } from "@/lib/branding-context";
import { confirmAction } from "@/lib/confirm";
import { formatCoordinates } from "@/lib/format";
import { OVERVIEW_RADIUS_M, positionedVehicles, sortVehicles, type LatLng } from "@/lib/map";
import { colors, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useVehicles, vehicleLabel } from "@/lib/vehicles";
import { selectZone, toggleZoneSelection, useSelectedZoneIds } from "@/lib/zone-selection";
import {
  DEFAULT_RADIUS_M,
  formatRadius,
  parseRadiusKm,
  RADIUS_MAX_M,
  RADIUS_MIN_M,
  radiusToKmText,
  useDeleteZone,
  useSaveZone,
  useZones,
  ZONES_PER_VEHICLE,
  type Zone,
} from "@/lib/zones";
import { VehicleMap } from "../map/VehicleMap";
import type { MapZone } from "../map/vehicle-map-props";

const noop = () => {};
/** Couleur du brouillon d'une nouvelle zone (la vraie couleur est attribuée à l'enregistrement). */
const NEW_ZONE_COLOR = "#475569";

interface Draft {
  /** Absent : nouvelle zone. */
  id?: string;
  name: string;
  /** Rayon saisi, en kilomètres. */
  radius: string;
  center: LatLng | null;
  vehicleIds: string[];
  color: string;
}

function monitoredLabel(count: number): string {
  if (count === 0) return "aucun véhicule surveillé";
  return count === 1 ? "1 véhicule surveillé" : `${count} véhicules surveillés`;
}

/**
 * Zones du client (dépôt, chantier, ville…) : carte, liste et, pour l'admin du client, création et
 * modification. Une zone n'est dessinée sur la carte que si elle est cochée dans la liste.
 */
export function ZonesScreen() {
  const router = useRouter();
  const branding = useBranding();
  useDocumentTitle(`Zones — ${branding.name}`);
  const { data, isPending, error, refetch } = useZones();
  const vehiclesQuery = useVehicles();
  const save = useSaveZone();
  const remove = useDeleteZone();
  const selectedIds = useSelectedZoneIds();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focus, setFocus] = useState<(LatLng & { radiusM?: number }) | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const allVehicles = useMemo(() => sortVehicles(vehiclesQuery.data?.vehicles ?? []), [vehiclesQuery.data]);
  const positioned = useMemo(() => positionedVehicles(allVehicles), [allVehicles]);
  const mapZones = useMemo<MapZone[]>(() => {
    // Zones cochées ; celle en cours de modification est remplacée par son brouillon.
    const shown: MapZone[] = (data?.zones ?? []).filter((z) => selectedIds.has(z.id) && z.id !== draft?.id);
    if (draft?.center) {
      shown.push({
        id: draft.id ?? "new",
        name: draft.name,
        ...draft.center,
        radiusM: parseRadiusKm(draft.radius) ?? DEFAULT_RADIUS_M,
        color: draft.color,
        draft: true,
      });
    }
    return shown;
  }, [data, draft, selectedIds]);

  if (isPending) return <LoadingState label="Chargement des zones…" />;
  if (!data) return <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />;
  const { zones, canEdit } = data;

  /** Nombre de zones qui surveillent déjà ce véhicule, hors zone en cours de modification. */
  const zonesOf = (vehicleId: string) => zones.filter((z) => z.id !== draft?.id && z.vehicleIds.includes(vehicleId)).length;

  const startNew = () => {
    setFormError(null);
    setListError(null);
    setDraft({ name: "", radius: radiusToKmText(DEFAULT_RADIUS_M), center: null, vehicleIds: [], color: NEW_ZONE_COLOR });
    // Vue d'ensemble : on place le centre d'une zone sur une carte dézoomée, pas au niveau de la rue.
    const anchor = positioned[0]?.position;
    if (anchor) setFocus({ latitude: anchor.latitude, longitude: anchor.longitude, radiusM: OVERVIEW_RADIUS_M });
  };
  const startEdit = (zone: Zone) => {
    setFormError(null);
    setListError(null);
    setDraft({
      id: zone.id,
      name: zone.name,
      radius: radiusToKmText(zone.radiusM),
      center: zone,
      vehicleIds: zone.vehicleIds,
      color: zone.color,
    });
    setFocus({ latitude: zone.latitude, longitude: zone.longitude, radiusM: zone.radiusM });
  };
  const toggleVehicle = (vehicleId: string) =>
    setDraft((d) =>
      d
        ? { ...d, vehicleIds: d.vehicleIds.includes(vehicleId) ? d.vehicleIds.filter((id) => id !== vehicleId) : [...d.vehicleIds, vehicleId] }
        : d,
    );

  const submit = async () => {
    if (!draft) return;
    const radiusM = parseRadiusKm(draft.radius);
    if (!draft.name.trim()) return setFormError("Donnez un nom à la zone.");
    if (radiusM === null) {
      return setFormError(`Rayon en kilomètres, entre ${radiusToKmText(RADIUS_MIN_M)} et ${radiusToKmText(RADIUS_MAX_M)}.`);
    }
    if (!draft.center) return setFormError("Appuyez sur la carte pour placer le centre de la zone.");
    setFormError(null);
    try {
      const { zone } = await save.mutateAsync({
        id: draft.id,
        name: draft.name.trim(),
        latitude: draft.center.latitude,
        longitude: draft.center.longitude,
        radiusM,
        vehicleIds: draft.vehicleIds,
      });
      // La zone qu'on vient d'enregistrer reste visible sur la carte.
      selectZone(zone.id);
      setDraft(null);
    } catch (err) {
      setFormError(formMessage(err));
    }
  };

  const deleteZone = async (zone: Zone) => {
    const ok = await confirmAction(
      `Supprimer la zone « ${zone.name} » ?`,
      "Les véhicules ne déclencheront plus d’alerte en y entrant ou en en sortant.",
      "Supprimer",
    );
    if (!ok) return;
    setListError(null);
    try {
      await remove.mutateAsync(zone.id);
    } catch (err) {
      setListError(formMessage(err));
    }
  };

  const toggleZone = (zone: Zone) => {
    // La carte se recadre pour montrer toute la zone qu'on vient de cocher.
    if (!selectedIds.has(zone.id)) setFocus({ latitude: zone.latitude, longitude: zone.longitude, radiusM: zone.radiusM });
    toggleZoneSelection(zone.id);
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Pressable
        accessibilityRole="link"
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/map"))}
        hitSlop={8}
        style={({ pressed }) => pressed && { opacity: 0.6 }}
      >
        <Text style={[styles.back, { color: branding.primaryColor }]}>‹ Carte</Text>
      </Pressable>

      <View style={styles.map}>
        <VehicleMap
          vehicles={positioned}
          selectedId={null}
          onSelect={noop}
          zones={mapZones}
          focus={focus}
          overview
          onMapPress={draft ? (center) => setDraft((d) => (d ? { ...d, center } : d)) : undefined}
        />
      </View>

      {draft ? (
        <Card title={draft.id ? "Modifier la zone" : "Nouvelle zone"}>
          <Text style={styles.muted}>
            {draft.center
              ? `Centre : ${formatCoordinates(draft.center.latitude, draft.center.longitude)}. Appuyez ailleurs sur la carte pour le déplacer.`
              : "Appuyez sur la carte pour placer le centre de la zone."}
          </Text>
          <TextField label="Nom" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} maxLength={100} />
          <TextField
            label="Rayon (kilomètres)"
            value={draft.radius}
            onChangeText={(text) => setDraft({ ...draft, radius: text })}
            keyboardType="decimal-pad"
            maxLength={7}
          />

          <Text style={styles.subtitle}>Véhicules surveillés</Text>
          <Text style={styles.muted}>
            Une alerte est émise quand un véhicule coché entre dans la zone ou en sort. Un véhicule peut être surveillé par{" "}
            {ZONES_PER_VEHICLE} zones au plus.
          </Text>
          {allVehicles.length === 0 ? <Text style={styles.muted}>Aucun véhicule.</Text> : null}
          {allVehicles.map((v) => {
            const checked = draft.vehicleIds.includes(v.id);
            const others = zonesOf(v.id);
            const full = !checked && others >= ZONES_PER_VEHICLE;
            return (
              <Pressable
                key={v.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled: full }}
                accessibilityLabel={vehicleLabel(v)}
                disabled={full}
                onPress={() => toggleVehicle(v.id)}
                style={[styles.check, full && { opacity: 0.5 }]}
              >
                <View style={[styles.box, checked && { backgroundColor: branding.primaryColor, borderColor: branding.primaryColor }]}>
                  {checked ? <Text style={[styles.tick, { color: branding.onPrimary }]}>✓</Text> : null}
                </View>
                <View style={styles.flex}>
                  <Text style={styles.zoneName}>{vehicleLabel(v)}</Text>
                  <Text style={styles.muted}>
                    {full
                      ? `Déjà surveillé par ${ZONES_PER_VEHICLE} zones (maximum)`
                      : others === 0
                        ? "Aucune autre zone"
                        : `${others} autre${others > 1 ? "s" : ""} zone${others > 1 ? "s" : ""}`}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          {formError ? (
            <Text style={styles.error} accessibilityRole="alert">
              {formError}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button label="Annuler" variant="secondary" onPress={() => setDraft(null)} disabled={save.isPending} />
            <Button label="Enregistrer la zone" onPress={submit} loading={save.isPending} />
          </View>
        </Card>
      ) : (
        <Card title={`Zones (${zones.length})`} right={canEdit ? <Button label="Nouvelle zone" onPress={startNew} /> : null}>
          {zones.length === 0 ? (
            <Text style={styles.muted}>
              {canEdit
                ? "Aucune zone. Créez-en une pour repérer un dépôt, un chantier ou une ville, et être alerté quand un véhicule en sort."
                : "Aucune zone n’a encore été créée par l’administrateur de votre société."}
            </Text>
          ) : (
            <Text style={styles.muted}>Cochez une zone pour l’afficher sur la carte.</Text>
          )}
          {listError ? (
            <Text style={styles.error} accessibilityRole="alert">
              {listError}
            </Text>
          ) : null}
          {zones.map((zone) => {
            const shown = selectedIds.has(zone.id);
            return (
              <View key={zone.id} style={styles.zone}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: shown }}
                  accessibilityLabel={`Afficher ${zone.name} sur la carte`}
                  onPress={() => toggleZone(zone)}
                  style={styles.zoneMain}
                >
                  <View style={[styles.box, { borderColor: zone.color }, shown && { backgroundColor: zone.color }]}>
                    {shown ? <Text style={[styles.tick, { color: "#FFFFFF" }]}>✓</Text> : null}
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.zoneName}>{zone.name}</Text>
                    <Text style={styles.muted}>
                      Rayon {formatRadius(zone.radiusM)} · {monitoredLabel(zone.vehicleIds.length)}
                    </Text>
                  </View>
                </Pressable>
                {canEdit ? (
                  <View style={styles.rowActions}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Modifier ${zone.name}`} onPress={() => startEdit(zone)} hitSlop={6}>
                      <Text style={[styles.link, { color: branding.primaryColor }]}>Modifier</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Supprimer ${zone.name}`} onPress={() => void deleteZone(zone)} hitSlop={6}>
                      <Text style={[styles.link, { color: colors.danger }]}>Supprimer</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, width: "100%", maxWidth: 900, alignSelf: "center" },
  flex: { flex: 1 },
  back: { fontSize: 16, fontWeight: "600" },
  map: { height: 380, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  muted: { fontSize: 14, color: colors.muted },
  subtitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  error: { fontSize: 14, color: colors.danger },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.md, flexWrap: "wrap" },
  zone: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  zoneMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  check: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  tick: { fontSize: 15, fontWeight: "700", lineHeight: 18 },
  zoneName: { fontSize: 16, fontWeight: "600", color: colors.text },
  rowActions: { flexDirection: "row", gap: spacing.lg },
  link: { fontSize: 15, fontWeight: "600" },
});
