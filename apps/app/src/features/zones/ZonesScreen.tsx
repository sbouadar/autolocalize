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
import { positionedVehicles, type LatLng } from "@/lib/map";
import { colors, radius, spacing } from "@/lib/theme";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useVehicles } from "@/lib/vehicles";
import {
  DEFAULT_RADIUS_M,
  formatRadius,
  parseRadius,
  RADIUS_MAX_M,
  RADIUS_MIN_M,
  useDeleteZone,
  useSaveZone,
  useZones,
  type Zone,
} from "@/lib/zones";
import { VehicleMap } from "../map/VehicleMap";
import type { MapZone } from "../map/vehicle-map-props";

const noop = () => {};

interface Draft {
  /** Absent : nouvelle zone. */
  id?: string;
  name: string;
  radius: string;
  center: LatLng | null;
}

/** Zones du client (dépôt, chantier…) : carte, liste et, pour l'admin du client, création et modification. */
export function ZonesScreen() {
  const router = useRouter();
  const branding = useBranding();
  useDocumentTitle(`Zones — ${branding.name}`);
  const { data, isPending, error, refetch } = useZones();
  const vehiclesQuery = useVehicles();
  const save = useSaveZone();
  const remove = useDeleteZone();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const vehicles = useMemo(() => positionedVehicles(vehiclesQuery.data?.vehicles ?? []), [vehiclesQuery.data]);
  const mapZones = useMemo<MapZone[]>(() => {
    // La zone en cours de modification est remplacée par son brouillon.
    const shown: MapZone[] = (data?.zones ?? []).filter((z) => z.id !== draft?.id);
    if (draft?.center) {
      shown.push({
        id: draft.id ?? "new",
        name: draft.name,
        ...draft.center,
        radiusM: parseRadius(draft.radius) ?? DEFAULT_RADIUS_M,
        draft: true,
      });
    }
    return shown;
  }, [data, draft]);

  if (isPending) return <LoadingState label="Chargement des zones…" />;
  if (!data) return <ErrorState message={userMessage(error)} onRetry={() => void refetch()} />;
  const { zones, canEdit } = data;

  const startNew = () => {
    setFormError(null);
    setListError(null);
    setDraft({ name: "", radius: String(DEFAULT_RADIUS_M), center: null });
  };
  const startEdit = (zone: Zone) => {
    setFormError(null);
    setListError(null);
    setDraft({ id: zone.id, name: zone.name, radius: String(zone.radiusM), center: zone });
    setFocus({ latitude: zone.latitude, longitude: zone.longitude });
  };

  const submit = async () => {
    if (!draft) return;
    const radiusM = parseRadius(draft.radius);
    if (!draft.name.trim()) return setFormError("Donnez un nom à la zone.");
    if (radiusM === null) return setFormError(`Rayon en mètres, entre ${RADIUS_MIN_M} et ${RADIUS_MAX_M}.`);
    if (!draft.center) return setFormError("Appuyez sur la carte pour placer le centre de la zone.");
    setFormError(null);
    try {
      await save.mutateAsync({
        id: draft.id,
        name: draft.name.trim(),
        latitude: draft.center.latitude,
        longitude: draft.center.longitude,
        radiusM,
      });
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
          vehicles={vehicles}
          selectedId={null}
          onSelect={noop}
          zones={mapZones}
          focus={focus}
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
            label="Rayon (mètres)"
            value={draft.radius}
            onChangeText={(text) => setDraft({ ...draft, radius: text })}
            keyboardType="number-pad"
            maxLength={6}
          />
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
                ? "Aucune zone. Créez-en une pour repérer un dépôt, un chantier ou un client sur la carte."
                : "Aucune zone n’a encore été créée par l’administrateur de votre société."}
            </Text>
          ) : null}
          {listError ? (
            <Text style={styles.error} accessibilityRole="alert">
              {listError}
            </Text>
          ) : null}
          {zones.map((zone) => (
            <View key={zone.id} style={styles.zone}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Afficher ${zone.name} sur la carte`}
                onPress={() => setFocus({ latitude: zone.latitude, longitude: zone.longitude })}
                style={styles.flex}
              >
                <Text style={styles.zoneName}>{zone.name}</Text>
                <Text style={styles.muted}>Rayon {formatRadius(zone.radiusM)}</Text>
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
          ))}
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
  zoneName: { fontSize: 16, fontWeight: "600", color: colors.text },
  rowActions: { flexDirection: "row", gap: spacing.lg },
  link: { fontSize: 15, fontWeight: "600" },
});
