import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { useBranding } from "@/lib/branding-context";
import { colors, fonts, radius, spacing } from "@/lib/theme";
import { fuelTypeSchema, type FuelType, type VehicleDetails } from "@/lib/types";
import { FUEL_LABELS, useUpdateVehicleInfo } from "@/lib/vehicle-info";

const EMPTY_DETAILS: VehicleDetails = { brand: null, model: null, year: null, vin: null, fuelType: null, color: null, notes: null };

interface VehicleInfoCardProps {
  vehicle: { id: string; name: string; plate: string | null; details?: VehicleDetails };
  canEdit: boolean;
}

/** Bloc « Informations » de la fiche : marque, modèle, année, énergie… ; modifiable par l'admin du client. */
export function VehicleInfoCard({ vehicle, canEdit }: VehicleInfoCardProps) {
  const details = vehicle.details ?? EMPTY_DETAILS;
  const [editing, setEditing] = useState(false);

  const rows: [string, string | null][] = [
    ["Marque et modèle", [details.brand, details.model].filter(Boolean).join(" ") || null],
    ["Année", details.year != null ? String(details.year) : null],
    ["Énergie", details.fuelType ? FUEL_LABELS[details.fuelType] : null],
    ["Couleur", details.color],
    ["N° de série (VIN)", details.vin],
  ];
  const filled = rows.filter((r): r is [string, string] => r[1] != null);

  return (
    <Card
      title="Informations"
      right={canEdit && !editing ? <Button label="Modifier" variant="secondary" onPress={() => setEditing(true)} /> : null}
    >
      {editing ? (
        <InfoForm vehicle={vehicle} details={details} onDone={() => setEditing(false)} />
      ) : (
        <>
          {filled.length === 0 && !details.notes ? (
            <Text style={styles.muted}>
              {canEdit ? "Aucune information : ajoutez la marque, le modèle, l’année…" : "Aucune information renseignée."}
            </Text>
          ) : null}
          {filled.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value} selectable>
                {value}
              </Text>
            </View>
          ))}
          {details.notes ? <Text style={styles.notes}>{details.notes}</Text> : null}
        </>
      )}
    </Card>
  );
}

function InfoForm({ vehicle, details, onDone }: { vehicle: VehicleInfoCardProps["vehicle"]; details: VehicleDetails; onDone: () => void }) {
  const branding = useBranding();
  const update = useUpdateVehicleInfo(vehicle.id);
  const [form, setForm] = useState({
    name: vehicle.name,
    plate: vehicle.plate ?? "",
    brand: details.brand ?? "",
    model: details.model ?? "",
    year: details.year != null ? String(details.year) : "",
    vin: details.vin ?? "",
    color: details.color ?? "",
    notes: details.notes ?? "",
  });
  const [fuelType, setFuelType] = useState<FuelType | null>(details.fuelType);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setError(null);
    const year = form.year.trim();
    if (year && !/^\d{4}$/.test(year)) {
      setError("L’année doit comporter 4 chiffres.");
      return;
    }
    if (!form.name.trim()) {
      setError("Le nom du véhicule est obligatoire.");
      return;
    }
    try {
      await update.mutateAsync({
        name: form.name.trim(),
        plate: form.plate,
        brand: form.brand,
        model: form.model,
        year: year ? Number(year) : null,
        vin: form.vin,
        color: form.color,
        notes: form.notes,
        fuelType,
      });
      onDone();
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <View style={styles.form}>
      <TextField label="Nom" value={form.name} onChangeText={set("name")} maxLength={191} />
      <TextField label="Plaque" value={form.plate} onChangeText={set("plate")} maxLength={32} autoCapitalize="characters" />
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label="Marque" value={form.brand} onChangeText={set("brand")} maxLength={64} />
        </View>
        <View style={styles.flex}>
          <TextField label="Modèle" value={form.model} onChangeText={set("model")} maxLength={64} />
        </View>
      </View>
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label="Année" value={form.year} onChangeText={set("year")} keyboardType="number-pad" maxLength={4} />
        </View>
        <View style={styles.flex}>
          <TextField label="Couleur" value={form.color} onChangeText={set("color")} maxLength={32} />
        </View>
      </View>
      <View style={styles.choices}>
        <Text style={styles.fieldLabel}>Énergie</Text>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Énergie">
          {fuelTypeSchema.options.map((key) => {
            const active = key === fuelType;
            return (
              <Pressable
                key={key}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                onPress={() => setFuelType(active ? null : key)}
                style={({ pressed }) => [styles.chip, active && { backgroundColor: branding.primaryColor }, pressed && { opacity: 0.8 }]}
              >
                <Text style={[styles.chipText, active && { color: branding.onPrimary }]}>{FUEL_LABELS[key]}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <TextField
        label="N° de série (VIN)"
        value={form.vin}
        onChangeText={set("vin")}
        maxLength={32}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <TextField label="Notes" value={form.notes} onChangeText={set("notes")} maxLength={2000} multiline style={styles.notesInput} />
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label="Enregistrer" onPress={() => void save()} loading={update.isPending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={onDone} disabled={update.isPending} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  muted: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  label: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  value: { fontFamily: fonts.bold, fontSize: 14, color: colors.text, flexShrink: 1, textAlign: "right" },
  notes: { fontFamily: fonts.regular, fontSize: 14, color: colors.text, marginTop: spacing.xs },
  form: { gap: spacing.md },
  pair: { flexDirection: "row", gap: spacing.sm },
  choices: { gap: spacing.xs },
  fieldLabel: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  chipText: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  notesInput: { minHeight: 88, textAlignVertical: "top", paddingTop: spacing.sm },
});
