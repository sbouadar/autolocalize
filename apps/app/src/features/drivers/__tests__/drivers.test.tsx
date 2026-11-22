import { fireEvent, render, screen } from "@testing-library/react-native";
import type { Assignment, Driver } from "@/lib/drivers";
import { DriverCard } from "../../vehicle/DriverCard";
import { DriverDetailScreen } from "../DriverDetailScreen";
import { DriversScreen, licenseWarning } from "../DriversScreen";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockAssign = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockRemove = jest.fn();
let mockRole = "TENANT_ADMIN";
let mockEnabled = true;
let mockDrivers: Driver[];
let mockVehicleDriver: { current: Assignment | null; assignments: Assignment[] };
let mockDetail: { driver: Driver; assignments: Assignment[] };

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{`redirection ${href}`}</Text>;
  },
}));
jest.mock("@/lib/auth", () => ({ useAuth: () => ({ me: { user: { role: mockRole }, tenant: { driversEnabled: mockEnabled } } }) }));
jest.mock("@/lib/confirm", () => ({ confirmAction: async () => true }));
jest.mock("@/lib/drivers", () => ({
  ...jest.requireActual("@/lib/drivers"),
  useDrivers: () => ({ data: { drivers: mockDrivers }, isPending: false, error: null, refetch: jest.fn() }),
  useDriver: () => ({ data: mockDetail, isPending: false, error: null, refetch: jest.fn() }),
  useDriverActivity: () => ({
    data: {
      liveDataAvailable: true,
      trips: 3,
      distanceKm: 120.5,
      drivingMs: 7_200_000,
      maxSpeedKmh: 118,
      alerts: { OVERSPEED: 2 },
      segments: [{ vehicleId: "v1", vehicleName: "Clio", from: "2026-11-20T08:00:00Z", to: "2026-11-22T08:00:00Z", trips: 3, distanceKm: 120.5 }],
    },
    isPending: false,
    error: null,
    refetch: jest.fn(),
  }),
  useDriverActions: () => ({ create: { mutateAsync: mockCreate, isPending: false }, update: { mutateAsync: mockUpdate, isPending: false }, remove: mockRemove }),
  useVehicleDriver: () => ({ data: mockVehicleDriver, isPending: false, isError: false }),
  useAssignDriver: () => ({ mutateAsync: mockAssign, isPending: false }),
}));

const driver = (over: Partial<Driver>): Driver => ({
  id: "d1",
  name: "Yassine",
  phone: "+212600000001",
  email: null,
  licenseNumber: "AB123",
  licenseExpiresOn: null,
  notes: null,
  active: true,
  currentVehicle: null,
  ...over,
});
const assignment = (over: Partial<Assignment>): Assignment => ({
  id: "a1",
  startAt: "2026-11-20T08:00:00Z",
  endAt: null,
  driver: { id: "d1", name: "Yassine" },
  vehicle: { id: "v1", name: "Clio", plate: null },
  ...over,
});

beforeEach(() => {
  mockRole = "TENANT_ADMIN";
  mockEnabled = true;
  mockDrivers = [driver({}), driver({ id: "d2", name: "Amine", currentVehicle: { id: "v2", name: "Master", plate: null, since: "2026-11-21T08:00:00Z" } })];
  mockVehicleDriver = { current: null, assignments: [] };
  mockDetail = { driver: driver({}), assignments: [] };
  for (const m of [mockPush, mockReplace, mockAssign, mockCreate, mockUpdate, mockRemove]) m.mockReset();
  mockAssign.mockResolvedValue({});
  mockCreate.mockResolvedValue({ driver: driver({ id: "d9", name: "Nouveau" }) });
  mockUpdate.mockResolvedValue({ driver: driver({}) });
  mockRemove.mockResolvedValue(undefined);
});

describe("licenseWarning", () => {
  it("signale un permis expiré ou qui expire dans 30 jours", () => {
    expect(licenseWarning({ licenseExpiresOn: "2026-11-01" }, "2026-11-22")).toBe("permis expiré le 01/11/2026");
    expect(licenseWarning({ licenseExpiresOn: "2026-12-10" }, "2026-11-22")).toBe("permis valable jusqu’au 10/12/2026");
    expect(licenseWarning({ licenseExpiresOn: "2027-06-01" }, "2026-11-22")).toBeNull();
    expect(licenseWarning({ licenseExpiresOn: null }, "2026-11-22")).toBeNull();
  });
});

describe("DriverCard", () => {
  it("affecte un conducteur au véhicule", async () => {
    await render(<DriverCard vehicleId="v1" canEdit />);
    expect(screen.getByText("Aucun conducteur affecté.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Changer" }));
    await fireEvent.press(screen.getByRole("button", { name: "Conducteur" }));
    // Un conducteur qui conduit un autre véhicule est signalé.
    expect(screen.getByRole("radio", { name: "Amine (conduit Master)" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Yassine" }));
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(mockAssign).toHaveBeenCalledWith({ driverId: "d1" });
  });

  it("montre le conducteur actuel et les précédents ; libère le véhicule", async () => {
    mockVehicleDriver = {
      current: assignment({}),
      assignments: [assignment({}), assignment({ id: "a0", driver: { id: "d2", name: "Amine" }, startAt: "2026-11-01T08:00:00Z", endAt: "2026-11-20T08:00:00Z" })],
    };
    await render(<DriverCard vehicleId="v1" canEdit />);
    expect(screen.getByText("Yassine")).toBeTruthy();
    expect(screen.getByText(/^Amine, du /)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /Yassine, depuis le/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/drivers/[id]", params: { id: "d1" } });
    await fireEvent.press(screen.getByRole("button", { name: "Changer" }));
    await fireEvent.press(screen.getByRole("button", { name: "Conducteur" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Aucun conducteur" }));
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(mockAssign).toHaveBeenCalledWith({ driverId: null });
  });

  it("ne propose pas de changer à un compte qui n'est pas admin", async () => {
    await render(<DriverCard vehicleId="v1" canEdit={false} />);
    expect(screen.queryByRole("button", { name: "Changer" })).toBeNull();
  });
});

describe("DriversScreen", () => {
  it("liste les conducteurs et en crée un", async () => {
    await render(<DriversScreen />);
    expect(screen.getByText(/^conduit Master/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(screen.getByText("Indiquez le nom du conducteur.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Nom"), " Nouveau ");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(mockCreate).toHaveBeenCalledWith({ name: "Nouveau", phone: null, email: null, licenseNumber: null, licenseExpiresOn: null, notes: null });
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/drivers/[id]", params: { id: "d9" } });
  });

  it("ne laisse pas un compte en consultation créer, et renvoie à l'accueil sans le module", async () => {
    mockRole = "VIEWER";
    await render(<DriversScreen />);
    expect(screen.queryByRole("button", { name: "Ajouter" })).toBeNull();
    mockEnabled = false;
    await render(<DriversScreen />);
    expect(screen.getByText("redirection /")).toBeTruthy();
  });
});

describe("DriverDetailScreen", () => {
  it("affiche l'activité et archive le conducteur", async () => {
    await render(<DriverDetailScreen id="d1" />);
    expect(screen.getByLabelText("Distance : 120,5 km")).toBeTruthy();
    expect(screen.getByText("Alertes : Excès de vitesse (2)")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Archiver le conducteur" }));
    expect(mockUpdate).toHaveBeenCalledWith({ id: "d1", body: { active: false } });
    // Sans historique, il peut aussi être supprimé.
    await fireEvent.press(screen.getByRole("button", { name: "Supprimer le conducteur" }));
    expect(mockRemove).toHaveBeenCalledWith("d1");
    expect(mockReplace).toHaveBeenCalledWith("/drivers");
  });

  it("n'offre la suppression qu'à un conducteur sans historique, et rien hors admin", async () => {
    mockDetail = { driver: driver({}), assignments: [assignment({ endAt: "2026-11-21T08:00:00Z" })] };
    await render(<DriverDetailScreen id="d1" />);
    expect(screen.queryByRole("button", { name: "Supprimer le conducteur" })).toBeNull();
    mockRole = "AGENT";
    await render(<DriverDetailScreen id="d1" />);
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull();
  });
});
