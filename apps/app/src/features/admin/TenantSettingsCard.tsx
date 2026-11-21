import { useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { SegmentedControl } from "@/components/SegmentedControl";
import { TextField } from "@/components/TextField";
import type { AdminTenant } from "@/lib/admin";
import { useBranding } from "@/lib/branding-context";
import { colors, fonts, spacing } from "@/lib/theme";
import type { Currency } from "@/lib/types";

const CURRENCY_OPTIONS: { key: Currency; label: string }[] = [
  { key: "MAD", label: "Dirham (MAD)" },
  { key: "EUR", label: "Euro (EUR)" },
  { key: "USD", label: "Dollar (USD)" },
];

interface TenantSettingsCardProps {
  tenant: AdminTenant;
  /** Enregistre un changement (PUT /admin/tenants/:id) ; les erreurs sont affichées par l'écran. */
  onUpdate: (body: Record<string, unknown>) => Promise<void>;
}

/** Réglages métier d'un client : devise, fuseau horaire et modules activés. */
export function TenantSettingsCard({ tenant, onUpdate }: TenantSettingsCardProps) {
  const branding = useBranding();
  const [timezone, setTimezone] = useState(tenant.timezone);
  const changedTimezone = timezone.trim() !== tenant.timezone;

  return (
    <Card title="Réglages métier">
      <Text style={styles.label}>Devise des montants</Text>
      <SegmentedControl options={CURRENCY_OPTIONS} value={tenant.currency} onChange={(currency) => void onUpdate({ currency })} />

      <View style={styles.timezone}>
        <View style={styles.flex}>
          <TextField
            label="Fuseau horaire"
            value={timezone}
            onChangeText={setTimezone}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Africa/Casablanca"
          />
        </View>
        <View style={styles.save}>
          <Button label="Enregistrer" variant="secondary" disabled={!changedTimezone} onPress={() => void onUpdate({ timezone: timezone.trim() })} />
        </View>
      </View>
      <Text style={styles.muted}>Fuseau des dates et des alertes quotidiennes (format IANA : Africa/Casablanca, Europe/Paris…).</Text>

      <Text style={styles.label}>Modules</Text>
      {(
        [
          ["rentalsEnabled", "Location", "Réservations, départs et retours des véhicules."],
          ["driversEnabled", "Conducteurs", "Conducteurs et affectations (flottes d’entreprise)."],
        ] as const
      ).map(([key, title, hint]) => (
        <View key={key} style={styles.module}>
          <View style={styles.flex}>
            <Text style={styles.moduleTitle}>{title}</Text>
            <Text style={styles.muted}>{hint}</Text>
          </View>
          <Switch
            accessibilityLabel={`Module ${title}`}
            value={tenant[key]}
            onValueChange={(value) => void onUpdate({ [key]: value })}
            trackColor={{ true: branding.primaryColor, false: colors.border }}
          />
        </View>
      ))}
      <Text style={styles.muted}>Les écrans de chaque module apparaissent dans l’application du client au fil de leur livraison.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  timezone: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  save: { minWidth: 130 },
  module: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  moduleTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
});
