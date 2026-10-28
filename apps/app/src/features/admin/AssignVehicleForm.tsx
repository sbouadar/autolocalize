import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { SegmentedControl } from "@/components/SegmentedControl";
import { TextField } from "@/components/TextField";
import { useDevices } from "@/lib/admin";
import { formMessage, userMessage } from "@/lib/api";
import { useBranding } from "@/lib/branding-context";
import { relativeTime } from "@/lib/format";
import { colors, radius, spacing } from "@/lib/theme";

type Mode = "existing" | "imei";
const IMEI = /^[0-9A-Za-z]{5,32}$/;

interface AssignVehicleFormProps {
  onAssign: (body: { name: string; plate: string | null; traccarDeviceId?: number; imei?: string }) => Promise<unknown>;
  onDone: () => void;
}

/** Affectation d'un traceur : appareil Traccar existant et libre, ou nouveau traceur par son IMEI. */
export function AssignVehicleForm({ onAssign, onDone }: AssignVehicleFormProps) {
  const branding = useBranding();
  const [mode, setMode] = useState<Mode>("existing");
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [imei, setImei] = useState("");
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const devices = useDevices(mode === "existing");
  const free = (devices.data?.devices ?? []).filter((d) => d.assignment === null);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Donnez un nom au véhicule.");
    if (mode === "existing" && deviceId === null) return setError("Choisissez un traceur dans la liste.");
    if (mode === "imei" && !IMEI.test(imei.trim())) return setError("IMEI invalide (5 à 32 chiffres ou lettres).");
    setSaving(true);
    try {
      await onAssign({
        name: name.trim(),
        plate: plate.trim() || null,
        ...(mode === "existing" ? { traccarDeviceId: deviceId! } : { imei: imei.trim() }),
      });
      onDone();
    } catch (err) {
      setError(formMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.form}>
      <SegmentedControl
        options={[
          { key: "existing", label: "Traceur existant" },
          { key: "imei", label: "Nouveau (IMEI)" },
        ]}
        value={mode}
        onChange={setMode}
      />
      <TextField label="Nom du véhicule" value={name} onChangeText={setName} maxLength={191} />
      <TextField label="Plaque (facultatif)" value={plate} onChangeText={setPlate} autoCapitalize="characters" maxLength={32} />

      {mode === "imei" ? (
        <TextField
          label="IMEI du traceur"
          value={imei}
          onChangeText={setImei}
          keyboardType="number-pad"
          autoCapitalize="none"
          maxLength={32}
        />
      ) : devices.isPending ? (
        <ActivityIndicator color={branding.primaryColor} />
      ) : devices.isError ? (
        <Text style={styles.error}>{userMessage(devices.error)}</Text>
      ) : free.length === 0 ? (
        <Text style={styles.muted}>Aucun traceur libre dans Traccar : déclarez-en un nouveau par son IMEI.</Text>
      ) : (
        <View style={styles.devices} accessibilityRole="radiogroup" accessibilityLabel="Traceurs libres">
          {free.map((d) => {
            const selected = d.id === deviceId;
            return (
              <Pressable
                key={d.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${d.name}, IMEI ${d.uniqueId}`}
                onPress={() => setDeviceId(d.id)}
                style={[styles.device, selected && { borderColor: branding.primaryColor, backgroundColor: branding.primarySoft }]}
              >
                <Text style={styles.deviceName}>{d.name}</Text>
                <Text style={styles.muted}>
                  IMEI {d.uniqueId} · {d.status === "online" ? "en ligne" : "hors ligne"} · vu {relativeTime(d.lastUpdate)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button label="Annuler" variant="secondary" onPress={onDone} />
        <Button label="Affecter le traceur" onPress={submit} loading={saving} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  devices: { gap: spacing.sm },
  device: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 2 },
  deviceName: { fontSize: 15, fontWeight: "600", color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  error: { fontSize: 14, color: colors.danger },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
