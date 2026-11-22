import { fireEvent, render, screen } from "@testing-library/react-native";
import { ExportsScreen } from "../ExportsScreen";

const mockOpen = jest.fn();
let mockRole = "TENANT_ADMIN";
let mockRentals = true;

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{`redirection ${href}`}</Text>;
  },
}));
jest.mock("@/lib/auth", () => ({ useAuth: () => ({ me: { user: { role: mockRole }, tenant: { rentalsEnabled: mockRentals } } }) }));
jest.mock("@/lib/private-pdf", () => ({ openPrivateCsv: (...args: unknown[]) => mockOpen(...args) }));
jest.mock("@/lib/vehicles", () => ({
  ...jest.requireActual("@/lib/vehicles"),
  useVehicles: () => ({ data: { vehicles: [{ id: "v1", name: "Clio", plate: "1-A-1" }] } }),
}));

beforeEach(() => {
  mockRole = "TENANT_ADMIN";
  mockRentals = true;
  mockOpen.mockReset().mockResolvedValue(undefined);
  jest.useFakeTimers({ doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "nextTick", "queueMicrotask"], now: new Date(2026, 10, 22, 10) });
});
afterEach(() => jest.useRealTimers());

const downloadButtons = () => screen.getAllByRole("button", { name: "Télécharger" });

describe("ExportsScreen", () => {
  it("télécharge les dépenses du mois en cours, pour un véhicule", async () => {
    await render(<ExportsScreen />);
    expect(screen.getByText("Locations")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Véhicule" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Clio" }));
    await fireEvent.press(downloadButtons()[2]!);
    expect(mockOpen).toHaveBeenCalledWith("/exports/expenses.csv?from=2026-11-01&to=2026-11-22&vehicleId=v1", "depenses-2026-11-01-2026-11-22.csv");
  });

  it("limite les trajets à 31 jours", async () => {
    await render(<ExportsScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Du" }));
    await fireEvent.press(screen.getByRole("button", { name: "Mois précédent" }));
    await fireEvent.press(screen.getByRole("button", { name: "1 octobre 2026" }));
    await fireEvent.press(downloadButtons()[0]!);
    expect(screen.getByText("Les trajets s’exportent sur 31 jours au plus.")).toBeTruthy();
    expect(mockOpen).not.toHaveBeenCalled();
    await fireEvent.press(downloadButtons()[3]!);
    expect(mockOpen).toHaveBeenCalledWith("/exports/maintenance.csv?from=2026-10-01&to=2026-11-22", "entretiens-2026-10-01-2026-11-22.csv");
  });

  it("masque les locations sans le module, et ferme l'écran aux agents", async () => {
    mockRentals = false;
    await render(<ExportsScreen />);
    expect(screen.queryByText("Locations")).toBeNull();
    mockRole = "AGENT";
    await render(<ExportsScreen />);
    expect(screen.getByText("redirection /")).toBeTruthy();
  });
});
