import { fireEvent, render, screen } from "@testing-library/react-native";
import type { AlertRule } from "@/lib/alert-rules";
import { AlertRulesScreen } from "../AlertRulesScreen";

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
const mockSavePrefs = jest.fn();
let mockRole = "TENANT_ADMIN";
let mockRules: AlertRule[] = [];
let mockMuted: string[] = [];

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }) }));
jest.mock("@/lib/auth", () => ({ useAuth: () => ({ me: { user: { role: mockRole } } }) }));
jest.mock("@/lib/confirm", () => ({ confirmAction: async () => true }));
jest.mock("@/lib/vehicles", () => ({ ...jest.requireActual("@/lib/vehicles"), useVehicles: () => ({ data: { vehicles: [{ id: "v1", name: "Clio", plate: null }] } }) }));
jest.mock("@/lib/zones", () => ({ useZones: () => ({ data: { zones: [{ id: "z1", name: "Dépôt" }] } }) }));
jest.mock("@/lib/alert-rules", () => ({
  ...jest.requireActual("@/lib/alert-rules"),
  useAlertRules: () => ({ data: { rules: mockRules }, isPending: false, error: null, refetch: jest.fn() }),
  useAlertRuleActions: () => ({ create: { mutateAsync: mockCreate, isPending: false }, update: mockUpdate, remove: mockRemove }),
  useAlertPreferences: () => ({ data: { mutedTypes: mockMuted } }),
  useSaveAlertPreferences: () => ({ mutateAsync: mockSavePrefs }),
}));

beforeEach(() => {
  mockRole = "TENANT_ADMIN";
  mockRules = [];
  mockMuted = [];
  for (const m of [mockCreate, mockUpdate, mockRemove, mockSavePrefs]) m.mockReset().mockResolvedValue({});
});

describe("AlertRulesScreen", () => {
  it("crée une règle de contact hors horaires sur les jours choisis", async () => {
    await render(<AlertRulesScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Ven" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Sam" }));
    await fireEvent.press(screen.getByRole("button", { name: "à" }));
    await fireEvent.press(screen.getByRole("radio", { name: "20:30" }));
    await fireEvent.press(screen.getByRole("button", { name: "Créer la règle" }));
    expect(mockCreate).toHaveBeenCalledWith({ type: "AFTER_HOURS", vehicleId: null, days: [1, 2, 3, 4, 6], startMinute: 420, endMinute: 1230 });
  });

  it("crée une règle de temps dans une zone pour un véhicule", async () => {
    await render(<AlertRulesScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Temps dans une zone" }));
    await fireEvent.press(screen.getByRole("button", { name: "Créer la règle" }));
    expect(screen.getByText("Choisissez la zone.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Zone" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Dépôt" }));
    await fireEvent.press(screen.getByRole("button", { name: "Véhicules" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Clio" }));
    await fireEvent.press(screen.getByRole("radio", { name: "4 h" }));
    await fireEvent.press(screen.getByRole("button", { name: "Créer la règle" }));
    expect(mockCreate).toHaveBeenCalledWith({ type: "ZONE_DWELL", vehicleId: "v1", zoneId: "z1", thresholdMinutes: 240 });
  });

  it("met une règle en pause et la supprime ; rien de modifiable hors admin", async () => {
    mockRules = [
      { id: "r1", type: "OFFLINE_DURATION", name: null, vehicleId: null, zoneId: null, startMinute: null, endMinute: null, days: [], thresholdMinutes: 360, enabled: true, vehicleName: null, zoneName: null, summary: "Traceur sans nouvelle depuis plus de 6 h" },
    ];
    const view = await render(<AlertRulesScreen />);
    expect(screen.getByText("Traceur sans nouvelle depuis plus de 6 h · tous les véhicules")).toBeTruthy();
    await fireEvent(screen.getByLabelText("Traceur muet : active"), "valueChange", false);
    expect(mockUpdate).toHaveBeenCalledWith("r1", { enabled: false });
    await fireEvent.press(screen.getByRole("button", { name: "Supprimer la règle Traceur muet" }));
    expect(mockRemove).toHaveBeenCalledWith("r1");
    await view.unmount();
    mockRole = "VIEWER";
    await render(<AlertRulesScreen />);
    expect(screen.queryByRole("button", { name: "Ajouter" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Supprimer la règle Traceur muet" })).toBeNull();
  });

  it("masque un groupe d'alertes pour l'utilisateur", async () => {
    mockMuted = ["OVERSPEED"];
    await render(<AlertRulesScreen />);
    expect(screen.getByLabelText("Afficher : Excès de vitesse").props.value).toBe(false);
    await fireEvent(screen.getByLabelText("Afficher : Entrées et sorties de zone"), "valueChange", false);
    expect(mockSavePrefs).toHaveBeenCalledWith(["OVERSPEED", "ZONE_ENTER", "ZONE_EXIT"]);
  });
});
