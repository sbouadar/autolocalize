import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ChoiceChips } from "@/components/ChoiceChips";
import { DateField } from "@/components/DateField";
import { Banner } from "@/components/States";
import { TextField } from "@/components/TextField";
import { formMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { confirmAction } from "@/lib/confirm";
import { formatDateOnly, todayIso } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS, expenseCategorySchema, useExpenseActions, useExpenses, type Expense, type ExpenseCategory } from "@/lib/expenses";
import { formatKm } from "@/lib/format";
import { formatMoney, parseAmount } from "@/lib/rentals";
import { colors, fonts, spacing } from "@/lib/theme";

const CATEGORY_OPTIONS = expenseCategorySchema.options.map((key) => ({ key, label: EXPENSE_CATEGORY_LABELS[key] }));
const SHOWN = 5;

/** Nombre décimal saisi (« 35,2 ») ; null si vide ; NaN si illisible. */
function parseDecimal(input: string): number | null {
  const v = input.replace(/[\s ]/g, "").replace(",", ".");
  if (!v) return null;
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : Number.NaN;
}

function ExpenseForm({ vehicleId, onDone }: { vehicleId: string; onDone: () => void }) {
  const { create } = useExpenseActions();
  const [category, setCategory] = useState<ExpenseCategory>("FUEL");
  const [spentOn, setSpentOn] = useState<string | null>(todayIso());
  const [amount, setAmount] = useState("");
  const [liters, setLiters] = useState("");
  const [km, setKm] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const value = parseAmount(amount);
    if (value == null || Number.isNaN(value) || value <= 0) return setError("Saisissez le montant en chiffres (ex. 450 ou 450,50).");
    if (!spentOn) return setError("Choisissez la date de la dépense.");
    const litersValue = category === "FUEL" ? parseDecimal(liters) : null;
    if (Number.isNaN(litersValue)) return setError("Saisissez les litres en chiffres (ex. 35,2).");
    const kmDigits = km.replace(/[\s ]/g, "");
    if (kmDigits && !/^\d+$/.test(kmDigits)) return setError("Saisissez le compteur en chiffres.");
    try {
      await create.mutateAsync({
        vehicleId,
        spentOn,
        category,
        amount: value,
        liters: litersValue,
        km: kmDigits ? Number(kmDigits) : null,
        notes: notes.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(formMessage(err));
    }
  };

  return (
    <View style={styles.form}>
      <ChoiceChips options={CATEGORY_OPTIONS} value={category} onChange={setCategory} label="Catégorie de la dépense" tone="fill" />
      <View style={styles.pair}>
        <View style={styles.flex}>
          <DateField label="Date" value={spentOn} onChange={setSpentOn} />
        </View>
        <View style={styles.flex}>
          <TextField label="Montant" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" maxLength={12} />
        </View>
      </View>
      <View style={styles.pair}>
        {category === "FUEL" ? (
          <View style={styles.flex}>
            <TextField label="Litres (facultatif)" value={liters} onChangeText={setLiters} keyboardType="decimal-pad" maxLength={7} />
          </View>
        ) : null}
        <View style={styles.flex}>
          <TextField label="Compteur (facultatif)" value={km} onChangeText={setKm} keyboardType="number-pad" maxLength={9} />
        </View>
      </View>
      <TextField label="Notes (facultatif)" value={notes} onChangeText={setNotes} maxLength={500} />
      {error ? <Banner message={error} tone="danger" /> : null}
      <View style={styles.pair}>
        <View style={styles.flex}>
          <Button label="Enregistrer" onPress={() => void save()} loading={create.isPending} />
        </View>
        <View style={styles.flex}>
          <Button label="Annuler" variant="secondary" onPress={onDone} disabled={create.isPending} />
        </View>
      </View>
    </View>
  );
}

function describe(e: Expense): string {
  return [
    formatDateOnly(e.spentOn),
    EXPENSE_CATEGORY_LABELS[e.category],
    e.liters != null ? `${String(e.liters).replace(".", ",")} L` : null,
    e.km != null ? formatKm(e.km) : null,
    e.notes,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Bloc « Dépenses » de la fiche : total des 30 derniers jours et dernières dépenses. Saisie par
 * l'admin et les agents, suppression par l'admin.
 */
export function ExpensesCard({ vehicleId, canAdd, canDelete }: { vehicleId: string; canAdd: boolean; canDelete: boolean }) {
  const currency = useAuth().me?.tenant?.currency ?? "MAD";
  const [since] = useState(() => todayIso(new Date(Date.now() - 29 * 86_400_000)));
  const recent = useExpenses({ vehicleId, from: since });
  const latest = useExpenses({ vehicleId });
  const { remove } = useExpenseActions();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const drop = async (e: Expense) => {
    const what = `${EXPENSE_CATEGORY_LABELS[e.category]} du ${formatDateOnly(e.spentOn)}, ${formatMoney(e.amount, currency)}`;
    if (!(await confirmAction("Supprimer cette dépense ?", what, "Supprimer"))) return;
    setMessage(null);
    try {
      await remove(e.id);
    } catch (err) {
      setMessage(formMessage(err));
    }
  };

  const expenses = latest.data?.expenses ?? [];
  return (
    <Card title="Dépenses" right={canAdd && !adding ? <Button label="Ajouter" variant="secondary" onPress={() => setAdding(true)} /> : null}>
      {adding ? <ExpenseForm vehicleId={vehicleId} onDone={() => setAdding(false)} /> : null}
      {message ? <Banner message={message} tone="danger" /> : null}
      {latest.isPending ? (
        <Text style={styles.muted}>Chargement…</Text>
      ) : latest.isError ? (
        <Text style={styles.muted}>Les dépenses n’ont pas pu être chargées.</Text>
      ) : expenses.length === 0 ? (
        <Text style={styles.muted}>Aucune dépense enregistrée : carburant, péages, réparations…</Text>
      ) : (
        <>
          <Text style={styles.total}>
            {formatMoney(recent.data?.total ?? "0", currency)} <Text style={styles.muted}>sur les 30 derniers jours</Text>
          </Text>
          {expenses.slice(0, SHOWN).map((e) => (
            <View key={e.id} style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.amount}>{formatMoney(e.amount, currency)}</Text>
                <Text style={styles.muted} numberOfLines={2}>
                  {describe(e)}
                </Text>
              </View>
              {canDelete ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Supprimer la dépense ${describe(e)}`} onPress={() => void drop(e)} hitSlop={8}>
                  <Text style={styles.delete}>Supprimer</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: spacing.md },
  pair: { flexDirection: "row", gap: spacing.sm },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
  total: { fontFamily: fonts.heavy, fontSize: 20, color: colors.text },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  amount: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  delete: { fontFamily: fonts.bold, fontSize: 13, color: colors.danger },
});
