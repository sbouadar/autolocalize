// Dépenses des véhicules et rentabilité (M7). Voir apps/api/src/routes/expenses.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";
import { isoDay, todayIso } from "./dates";
import { currencySchema } from "./types";

export const expenseCategorySchema = z.enum(["FUEL", "MAINTENANCE", "REPAIR", "INSURANCE", "TAX", "TOLL", "FINE", "PARKING", "CLEANING", "OTHER"]);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  FUEL: "Carburant",
  MAINTENANCE: "Entretien",
  REPAIR: "Réparation",
  INSURANCE: "Assurance",
  TAX: "Taxes",
  TOLL: "Péage",
  FINE: "Amende",
  PARKING: "Stationnement",
  CLEANING: "Lavage",
  OTHER: "Autre",
};

export const expenseSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  vehicleName: z.string(),
  vehiclePlate: z.string().nullable(),
  spentOn: z.string(),
  category: expenseCategorySchema.catch("OTHER"),
  /** Montant en chaîne (« 450.50 »). */
  amount: z.string(),
  liters: z.number().nullable(),
  km: z.number().nullable(),
  maintenanceRecordId: z.string().nullable(),
  notes: z.string().nullable(),
});
export type Expense = z.infer<typeof expenseSchema>;

const expensesResponse = z.object({ expenses: z.array(expenseSchema), total: z.string(), count: z.number(), truncated: z.boolean() });

export interface ExpenseInput {
  vehicleId: string;
  spentOn: string;
  category: ExpenseCategory;
  amount: number;
  liters?: number | null;
  km?: number | null;
  notes?: string | null;
}

const EXPENSES_KEY = ["expenses"] as const;

export function useExpenses(params: { vehicleId?: string; from?: string; to?: string } = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return useQuery({
    queryKey: [...EXPENSES_KEY, "list", query],
    queryFn: () => api(`/expenses${query ? `?${query}` : ""}`, { schema: expensesResponse }),
    staleTime: 30_000,
  });
}

export function useExpenseActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: EXPENSES_KEY });
  return {
    create: useMutation({
      mutationFn: (body: ExpenseInput) => api("/expenses", { method: "POST", body }),
      onSuccess: refresh,
    }),
    remove: (id: string) => api(`/expenses/${encodeURIComponent(id)}`, { method: "DELETE" }).then(refresh),
  };
}

const amountPair = z.object({ category: expenseCategorySchema.catch("OTHER"), amount: z.string() });
const profitabilitySchema = z.object({
  from: z.string(),
  to: z.string(),
  currency: currencySchema.catch("MAD"),
  rentalsEnabled: z.boolean(),
  distanceAvailable: z.boolean(),
  totals: z.object({
    revenue: z.string(),
    expenses: z.string(),
    margin: z.string(),
    distanceKm: z.number().nullable(),
    costPerKm: z.string().nullable(),
    fuelLiters: z.number(),
  }),
  byCategory: z.array(amountPair),
  vehicles: z.array(
    z.object({
      vehicleId: z.string(),
      name: z.string(),
      plate: z.string().nullable(),
      rentalCount: z.number(),
      revenue: z.string(),
      expenses: z.string(),
      margin: z.string(),
      distanceKm: z.number().nullable(),
      costPerKm: z.string().nullable(),
      fuelLiters: z.number(),
      consumptionL100: z.number().nullable(),
      byCategory: z.array(amountPair),
    }),
  ),
});
export type Profitability = z.infer<typeof profitabilitySchema>;

/** Rentabilité sur une période de jours (inclus), dans le fuseau du client. */
export function useProfitability(from: string, to: string) {
  return useQuery({
    queryKey: [...EXPENSES_KEY, "profitability", from, to],
    queryFn: () => api(`/reports/profitability?from=${from}&to=${to}`, { schema: profitabilitySchema }),
    staleTime: 60_000,
  });
}

export type ProfitPeriodKey = "month" | "lastMonth" | "quarter" | "year";
export const PROFIT_PERIODS: { key: ProfitPeriodKey; label: string }[] = [
  { key: "month", label: "Ce mois" },
  { key: "lastMonth", label: "Mois dernier" },
  { key: "quarter", label: "3 mois" },
  { key: "year", label: "12 mois" },
];

/** Jours de début et de fin (inclus) d'une période, en dates locales. */
export function profitPeriod(key: ProfitPeriodKey, now = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = todayIso(now);
  switch (key) {
    case "month":
      return { from: isoDay(y, m, 1), to: today };
    case "lastMonth": {
      const last = new Date(y, m, 0);
      return { from: isoDay(last.getFullYear(), last.getMonth(), 1), to: todayIso(last) };
    }
    case "quarter": {
      const start = new Date(y, m - 2, 1);
      return { from: isoDay(start.getFullYear(), start.getMonth(), 1), to: today };
    }
    case "year": {
      // 12 mois glissants, mois en cours compris : 365 jours au plus, sous la limite de l'API.
      const start = new Date(y, m - 11, 1);
      return { from: isoDay(start.getFullYear(), start.getMonth(), 1), to: today };
    }
  }
}
