import { fireEvent, render, screen } from "@testing-library/react-native";
import type { Expense } from "@/lib/expenses";
import { ExpensesCard } from "../ExpensesCard";

const mockCreate = jest.fn();
const mockRemove = jest.fn();
const mockQueries: Record<string, unknown>[] = [];
let mockList: Expense[];

jest.mock("@/lib/expenses", () => ({
  ...jest.requireActual("@/lib/expenses"),
  useExpenses: (params: Record<string, unknown>) => {
    mockQueries.push(params);
    return { data: { expenses: mockList, total: params.from ? "475.50" : "999.00", count: mockList.length, truncated: false }, isPending: false, isError: false };
  },
  useExpenseActions: () => ({ create: { mutateAsync: mockCreate, isPending: false }, remove: mockRemove }),
}));
jest.mock("@/lib/auth", () => ({ useAuth: () => ({ me: { user: { role: "TENANT_ADMIN" }, tenant: { currency: "MAD" } } }) }));
jest.mock("@/lib/confirm", () => ({ confirmAction: async () => true }));

const fuel: Expense = {
  id: "e1",
  vehicleId: "v1",
  vehicleName: "Clio",
  vehiclePlate: null,
  spentOn: "2026-11-20",
  category: "FUEL",
  amount: "450.50",
  liters: 35.2,
  km: 45_000,
  maintenanceRecordId: null,
  notes: null,
};

beforeEach(() => {
  mockList = [];
  mockQueries.length = 0;
  for (const m of [mockCreate, mockRemove]) m.mockReset();
  mockCreate.mockResolvedValue({});
  mockRemove.mockResolvedValue(undefined);
});

describe("ExpensesCard", () => {
  it("montre le total des 30 derniers jours et les dernières dépenses", async () => {
    mockList = [fuel];
    await render(<ExpensesCard vehicleId="v1" canAdd={false} canDelete={false} />);
    expect(screen.getByText(/475,5 DH/)).toBeTruthy();
    expect(screen.getByText("450,5 DH")).toBeTruthy();
    expect(screen.getByText("20/11/2026 · Carburant · 35,2 L · 45 000 km")).toBeTruthy();
    expect(mockQueries.some((q) => q.vehicleId === "v1" && typeof q.from === "string")).toBe(true);
    expect(screen.queryByRole("button", { name: "Ajouter" })).toBeNull();
    expect(screen.queryByText("Supprimer")).toBeNull();
  });

  it("enregistre un plein avec ses litres, et refuse un montant illisible", async () => {
    await render(<ExpensesCard vehicleId="v1" canAdd canDelete={false} />);
    expect(screen.getByText(/Aucune dépense enregistrée/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    await fireEvent.changeText(screen.getByLabelText("Montant"), "abc");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(screen.getByText(/Saisissez le montant en chiffres/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Montant"), "450,50");
    await fireEvent.changeText(screen.getByLabelText("Litres (facultatif)"), "35,2");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ vehicleId: "v1", category: "FUEL", amount: 450.5, liters: 35.2, km: null, notes: null }));
    expect(mockCreate.mock.calls[0]![0].spentOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("n'envoie pas de litres pour une autre catégorie", async () => {
    await render(<ExpensesCard vehicleId="v1" canAdd canDelete={false} />);
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Péage" }));
    expect(screen.queryByLabelText("Litres (facultatif)")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Montant"), "25");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ category: "TOLL", amount: 25, liters: null }));
  });

  it("laisse l'admin supprimer une dépense, après confirmation", async () => {
    mockList = [fuel];
    await render(<ExpensesCard vehicleId="v1" canAdd canDelete />);
    await fireEvent.press(screen.getByRole("button", { name: /Supprimer la dépense/ }));
    expect(mockRemove).toHaveBeenCalledWith("e1");
  });
});
