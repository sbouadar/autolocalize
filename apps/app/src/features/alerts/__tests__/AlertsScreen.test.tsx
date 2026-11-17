import { fireEvent, render, screen } from "@testing-library/react-native";
import { alertLabel, type Alert } from "@/lib/alerts";
import { ApiError } from "@/lib/api";
import { AlertsScreen } from "../AlertsScreen";

let mockQuery: { data?: { alerts: Alert[]; hasMore: boolean }; isPending: boolean; error: unknown; refetch: jest.Mock };
const mockPush = jest.fn();

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/alerts", () => ({ ...jest.requireActual("@/lib/alerts"), useAlerts: () => mockQuery }));

const alert = (overrides: Partial<Alert>): Alert => ({
  id: "a1",
  type: "ZONE_ENTER",
  eventTime: "2026-11-17T10:00:00.000Z",
  vehicleId: "v1",
  vehicleName: "Camion",
  zoneName: "Dépôt",
  latitude: 33.5,
  longitude: -7.6,
  speedKmh: 37,
  detail: null,
  ...overrides,
});

beforeEach(() => {
  mockPush.mockReset();
  mockQuery = { data: { alerts: [alert({})], hasMore: false }, isPending: false, error: null, refetch: jest.fn() };
});

describe("alertLabel", () => {
  it("décrit chaque type d'alerte", () => {
    expect(alertLabel(alert({}))).toBe("Entrée dans la zone Dépôt");
    expect(alertLabel(alert({ type: "ZONE_EXIT", zoneName: null }))).toBe("Sortie d’une zone");
    expect(alertLabel(alert({ type: "OVERSPEED", speedKmh: 112.4 }))).toBe("Excès de vitesse (112 km/h)");
    expect(alertLabel(alert({ type: "DEVICE_OFFLINE" }))).toBe("Traceur hors ligne");
    expect(alertLabel(alert({ type: "ALARM", detail: "lowBattery" }))).toBe("Batterie du traceur faible");
    expect(alertLabel(alert({ type: "ALARM", detail: "inconnue" }))).toBe("Alarme du traceur");
    expect(alertLabel(alert({ type: "FUTUR" }))).toBe("Alerte");
  });
});

describe("AlertsScreen", () => {
  it("liste les alertes et ouvre la fiche du véhicule", async () => {
    await render(<AlertsScreen />);
    expect(screen.getByText("Entrée dans la zone Dépôt")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Entrée dans la zone Dépôt, Camion/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/vehicles/[id]", params: { id: "v1" } });
  });

  it("affiche sans lien l'alerte d'un véhicule retiré", async () => {
    mockQuery.data = { alerts: [alert({ vehicleId: null })], hasMore: true };
    await render(<AlertsScreen />);
    expect(screen.getByText("Entrée dans la zone Dépôt")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Seules les 50 alertes les plus récentes sont affichées.")).toBeTruthy();
  });

  it("indique l'absence d'alerte", async () => {
    mockQuery.data = { alerts: [], hasMore: false };
    await render(<AlertsScreen />);
    expect(screen.getByText("Aucune alerte")).toBeTruthy();
  });

  it("propose de réessayer si le chargement échoue", async () => {
    mockQuery = { data: undefined, isPending: false, error: new ApiError(0, "Serveur injoignable."), refetch: jest.fn() };
    await render(<AlertsScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Réessayer" }));
    expect(mockQuery.refetch).toHaveBeenCalled();
  });
});
