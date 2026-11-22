import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { DateField } from "@/components/DateField";
import { TextField } from "@/components/TextField";
import type { AdminTenant } from "@/lib/admin";
import { parseAmount } from "@/lib/rentals";
import { colors, fonts, spacing } from "@/lib/theme";

interface BillingCardProps {
  tenant: AdminTenant;
  /** Enregistre (PUT /admin/tenants/:id) ; les erreurs sont affichées par l'écran. */
  onUpdate: (body: Record<string, unknown>) => Promise<void>;
}

/** Abonnement d'un client (super-admin) : formule, quota, montant mensuel, échéance, notes. */
export function BillingCard({ tenant, onUpdate }: BillingCardProps) {
  const [plan, setPlan] = useState(tenant.plan ?? "");
  const [quota, setQuota] = useState(tenant.vehicleQuota != null ? String(tenant.vehicleQuota) : "");
  const [fee, setFee] = useState(tenant.monthlyFee ? tenant.monthlyFee.replace(".", ",") : "");
  const [paidUntil, setPaidUntil] = useState<string | null>(tenant.paidUntil ?? null);
  const [notes, setNotes] = useState(tenant.billingNotes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError(null);
    const quotaDigits = quota.replace(/\s/g, "");
    if (quotaDigits && !/^\d+$/.test(quotaDigits)) return setError("Saisissez le quota en nombre de véhicules.");
    const feeValue = parseAmount(fee);
    if (Number.isNaN(feeValue)) return setError("Saisissez le montant en chiffres (ex. 450 ou 450,50).");
    setSaving(true);
    try {
      await onUpdate({
        plan: plan.trim() || null,
        vehicleQuota: quotaDigits ? Number(quotaDigits) : null,
        monthlyFee: feeValue,
        paidUntil,
        billingNotes: notes.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Facturation">
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label="Formule" value={plan} onChangeText={setPlan} maxLength={32} placeholder="ex. Pro" />
        </View>
        <View style={styles.flex}>
          <TextField label="Véhicules prévus" value={quota} onChangeText={setQuota} keyboardType="number-pad" maxLength={5} />
        </View>
      </View>
      <View style={styles.pair}>
        <View style={styles.flex}>
          <TextField label={`Montant mensuel (${tenant.currency})`} value={fee} onChangeText={setFee} keyboardType="decimal-pad" maxLength={12} />
        </View>
        <View style={styles.flex}>
          <DateField label="Payé jusqu’au" value={paidUntil} onChange={setPaidUntil} />
        </View>
      </View>
      <TextField label="Notes (mode de paiement, relances…)" value={notes} onChangeText={setNotes} maxLength={5000} multiline />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.muted}>Aucune suspension automatique : à l’échéance, le client reste actif jusqu’à ce que vous changiez son statut.</Text>
      <Button label="Enregistrer la facturation" variant="secondary" onPress={() => void save()} loading={saving} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pair: { flexDirection: "row", gap: spacing.sm },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
});
