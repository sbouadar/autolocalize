import { fireEvent, render, screen } from "@testing-library/react-native";
import { profitPeriod, type Profitability } from "@/lib/expenses";
import { ProfitabilityScreen } from "../ProfitabilityScreen";

const mockPush = jest.fn();
const mockArgs: string[][] = [];
let mockRole = "TENANT_ADMIN";
let mockData: Profitability;

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{`redirection ${href}`}</Text>;
  },
}));
jest.mock("@/lib/auth", () => ({ useAuth: () => ({ me: { user: { role: mockRole }, tenant: { currency: "MAD" } } }) }));
jest.mock("@/lib/expenses", () => ({
  ...jest.requireActual("@/lib/expenses"),
  useProfitability: (from: string, to: string) => {
    mockArgs.push([from, to]);
    return { data: mockData, isPending: false, error: null, refetch: jest.fn() };
  },
}));

const vehicle = (over: Partial<Profitability["vehicles"][number]>): Profitability["vehicles"][number] => ({
  vehicleId: "v1",
  name: "Clio",
  plate: null,
  rentalCount: 1,
  revenue: "1200.50",
  expenses: "420.25",
  margin: "780.25",
  distanceKm: 500,
  costPerKm: "0.84",
  fuelLiters: 40,
  consumptionL100: 8,
  byCategory: [],
  ...over,
});

beforeEach(() => {
  mockRole = "TENANT_ADMIN";
  mockArgs.length = 0;
  mockData = {
    from: "2026-11-01",
    to: "2026-11-22",
    currency: "MAD",
    rentalsEnabled: true,
    distanceAvailable: true,
    totals: { revenue: "1200.50", expenses: "2420.25", margin: "-1219.75", distanceKm: 500, costPerKm: "4.84", fuelLiters: 40 },
    byCategory: [
      { category: "REPAIR", amount: "2000.00" },
      { category: "FUEL", amount: "400.00" },
    ],
    vehicles: [vehicle({}), vehicle({ vehicleId: "v2", name: "Master", rentalCount: 0, revenue: "0.00", expenses: "2000.00", margin: "-2000.00", distanceKm: 0, costPerKm: null, consumptionL100: null })],
  };
});

describe("ProfitabilityScreen", () => {
  it("affiche recettes, dépenses, marge, répartition et détail par véhicule", async () => {
    await render(<ProfitabilityScreen />);
    expect(screen.getByLabelText("Recettes : 1 200,5 DH, locations terminées")).toBeTruthy();
    expect(screen.getByLabelText("Marge : -1 219,75 DH")).toBeTruthy();
    expect(screen.getByLabelText("Coût au km : 4,84 DH/km")).toBeTruthy();
    expect(screen.getByLabelText("Réparation : 2 000 DH")).toBeTruthy();
    expect(screen.getByText("1 location · recettes 1 200,5 DH · dépenses 420,25 DH · 500 km · 0,84 DH/km · 8 L/100 km")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Master/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/vehicles/[id]", params: { id: "v2" } });
  });

  it("change de période", async () => {
    await render(<ProfitabilityScreen />);
    await fireEvent.press(screen.getByRole("radio", { name: "12 mois" }));
    expect(mockArgs.at(-1)).toEqual([profitPeriod("year").from, profitPeriod("year").to]);
  });

  it("sans module location, ne parle que des dépenses", async () => {
    mockData = { ...mockData, rentalsEnabled: false };
    await render(<ProfitabilityScreen />);
    expect(screen.queryByLabelText(/^Recettes/)).toBeNull();
    expect(screen.queryByLabelText(/^Marge/)).toBeNull();
    expect(screen.getByRole("button", { name: "Master : dépenses 2 000 DH. Ouvrir la fiche" })).toBeTruthy();
  });

  it("est fermé aux agents", async () => {
    mockRole = "AGENT";
    await render(<ProfitabilityScreen />);
    expect(screen.getByText("redirection /")).toBeTruthy();
  });
});

describe("profitPeriod", () => {
  it("calcule les mois en dates locales", () => {
    const now = new Date(2026, 0, 15, 10);
    expect(profitPeriod("month", now)).toEqual({ from: "2026-01-01", to: "2026-01-15" });
    expect(profitPeriod("lastMonth", now)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(profitPeriod("quarter", now)).toEqual({ from: "2025-11-01", to: "2026-01-15" });
    expect(profitPeriod("year", now)).toEqual({ from: "2025-02-01", to: "2026-01-15" });
  });
});
