import { fireEvent, render, screen } from "@testing-library/react-native";
import type { Deadline, MaintenancePlan, Unavailability } from "@/lib/fleet-care";
import { FleetWatch } from "../FleetWatch";

const mockPush = jest.fn();
let mockDeadlines: Deadline[];
let mockUnavailable: Unavailability[];
let mockMaintenance: MaintenancePlan[] = [];

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/fleet-care", () => ({
  ...jest.requireActual("@/lib/fleet-care"),
  useDueDeadlines: () => ({ data: { deadlines: mockDeadlines } }),
  useCurrentUnavailabilities: () => ({ data: { unavailabilities: mockUnavailable } }),
  useDueMaintenance: () => ({ data: { plans: mockMaintenance } }),
}));

const deadline = (overrides: Partial<Deadline>): Deadline => ({
  id: "d1",
  vehicleId: "v1",
  vehicleName: "Clio",
  vehiclePlate: null,
  type: "INSURANCE",
  label: null,
  expiresOn: "2026-12-02",
  reference: null,
  warnDaysBefore: 30,
  notes: null,
  daysLeft: 10,
  status: "WARNING",
  ...overrides,
});

beforeEach(() => {
  mockPush.mockReset();
  mockDeadlines = [];
  mockUnavailable = [];
  mockMaintenance = [];
});

describe("FleetWatch", () => {
  it("ne s'affiche pas quand il n'y a rien à signaler", async () => {
    await render(<FleetWatch />);
    expect(screen.queryByText("À surveiller")).toBeNull();
  });

  it("liste les échéances proches ou dépassées et mène à la fiche du véhicule", async () => {
    mockDeadlines = [
      deadline({ id: "d0", type: "OTHER", label: "Extincteur", daysLeft: -3, status: "EXPIRED", vehicleId: "v2", vehicleName: "Master" }),
      deadline({}),
    ];
    await render(<FleetWatch />);
    expect(screen.getByText("expirée depuis 3 jours")).toBeTruthy();
    expect(screen.getByText("Extincteur · 02/12/2026")).toBeTruthy();
    expect(screen.getByText("expire dans 10 jours")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Clio, Assurance : expire dans 10 jours/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/vehicles/[id]", params: { id: "v1" } });
  });

  it("signale les entretiens à prévoir ou en retard", async () => {
    mockMaintenance = [
      { id: "m1", vehicleId: "v1", vehicleName: "Clio", type: "OIL_CHANGE", label: null, intervalKm: 10_000, intervalDays: null, lastDoneAt: null, lastDoneKm: 40_000, currentKm: 50_300, status: "OVERDUE", nextKm: 50_000, kmLeft: -300, nextDate: null, daysLeft: null },
    ];
    await render(<FleetWatch />);
    expect(screen.getByText("Entretien : vidange")).toBeTruthy();
    expect(screen.getByText("dépassé de 300 km")).toBeTruthy();
  });

  it("signale les véhicules immobilisés", async () => {
    mockUnavailable = [
      { id: "u1", vehicleId: "v3", vehicleName: "Kangoo", vehiclePlate: null, startAt: "2026-11-20T08:00:00Z", endAt: null, reason: "REPAIR", notes: null, current: true, past: false },
    ];
    await render(<FleetWatch />);
    expect(screen.getByText("Indisponible : réparation")).toBeTruthy();
  });
});
