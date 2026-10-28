import { fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import type { Kpis } from "@/lib/types";
import { DashboardScreen } from "../DashboardScreen";

type Query = { data?: Kpis; isPending: boolean; error: unknown; refetch: jest.Mock };
let mockQuery: Query;
const mockRanges: { from: string; to: string }[] = [];
const mockPush = jest.fn();

jest.mock("@/lib/dashboard", () => ({
  useKpis: (range: { from: string; to: string }) => {
    mockRanges.push(range);
    return mockQuery;
  },
}));
jest.mock("@/lib/auth", () => ({
  useAuth: () => ({ me: { user: { name: "Alice" }, tenant: null } }),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

const kpis: Kpis = {
  liveDataAvailable: true,
  reportsAvailable: true,
  fleet: { total: 3, online: 2, offline: 1, unknown: 0, moving: 1 },
  totals: { distanceKm: 53.3, drivingMs: 6_000_000, engineHoursMs: 7_800_000, maxSpeedKmh: 111.1, trips: 3 },
  vehicles: [
    { id: "v1", name: "Roule", plate: null, distanceKm: 52.3, drivingMs: 5_400_000, engineHoursMs: 0, maxSpeedKmh: 111.1, trips: 2 },
    { id: "v2", name: "Garé", plate: null, distanceKm: 1, drivingMs: 600_000, engineHoursMs: 0, maxSpeedKmh: 18.5, trips: 1 },
  ],
};

beforeEach(() => {
  mockRanges.length = 0;
  mockQuery = { data: kpis, isPending: false, error: null, refetch: jest.fn() };
});

describe("DashboardScreen", () => {
  it("affiche l'état de la flotte et l'activité", async () => {
    await render(<DashboardScreen />);
    expect(screen.getByText("Bonjour Alice")).toBeTruthy();
    expect(screen.getByLabelText("Véhicules : 3")).toBeTruthy();
    expect(screen.getByLabelText("En mouvement : 1")).toBeTruthy();
    expect(screen.getByLabelText("Hors ligne : 1")).toBeTruthy();
    expect(screen.getByLabelText(/^Distance : 53,3\s?km$/)).toBeTruthy();
    expect(screen.getByLabelText("Temps de conduite : 1 h 40")).toBeTruthy();
  });

  it("ouvre la fiche d'un véhicule depuis le classement", async () => {
    await render(<DashboardScreen />);
    await fireEvent.press(screen.getByRole("button", { name: /^Roule :/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/vehicles/[id]", params: { id: "v1" } });
  });

  it("recharge les indicateurs pour la période choisie", async () => {
    await render(<DashboardScreen />);
    const first = mockRanges.at(-1)!;
    await fireEvent.press(screen.getByRole("radio", { name: "30 jours" }));
    const last = mockRanges.at(-1)!;
    expect(Date.parse(last.from)).toBeLessThan(Date.parse(first.from));
  });

  it("garde l'état de la flotte quand les rapports sont indisponibles", async () => {
    mockQuery = { ...mockQuery, data: { ...kpis, reportsAvailable: false, totals: null, vehicles: [] } };
    await render(<DashboardScreen />);
    expect(screen.getByLabelText("Véhicules : 3")).toBeTruthy();
    expect(screen.getByText("Les rapports d’activité sont momentanément indisponibles.")).toBeTruthy();
  });

  it("propose de réessayer si le chargement échoue", async () => {
    mockQuery = { data: undefined, isPending: false, error: new ApiError(0, "Serveur injoignable."), refetch: jest.fn() };
    await render(<DashboardScreen />);
    expect(screen.getByText("Serveur injoignable.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Réessayer" }));
    expect(mockQuery.refetch).toHaveBeenCalled();
  });
});
