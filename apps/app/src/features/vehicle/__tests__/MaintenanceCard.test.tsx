import { fireEvent, render, screen } from "@testing-library/react-native";
import type { MaintenancePlan } from "@/lib/fleet-care";
import { maintenanceDelay } from "@/lib/fleet-care";
import { MaintenanceCard } from "../MaintenanceCard";

const mockCreatePlan = jest.fn();
const mockAddRecord = jest.fn();
const mockRemovePlan = jest.fn();
let mockPlans: MaintenancePlan[];

jest.mock("@/lib/fleet-care", () => ({
  ...jest.requireActual("@/lib/fleet-care"),
  useMaintenancePlans: () => ({ data: { plans: mockPlans }, isPending: false, isError: false, refetch: jest.fn() }),
  useMaintenanceRecords: () => ({
    data: { records: [{ id: "r1", planId: "m1", type: "OIL_CHANGE", label: null, doneOn: "2026-03-01", km: 40_000, garage: "Garage Atlas", notes: null }] },
  }),
  useMaintenanceActions: () => ({
    createPlan: { mutateAsync: mockCreatePlan, isPending: false },
    addRecord: { mutateAsync: mockAddRecord, isPending: false },
    removePlan: mockRemovePlan,
  }),
}));
jest.mock("@/lib/confirm", () => ({ confirmAction: async () => true }));

const oil: MaintenancePlan = {
  id: "m1",
  vehicleId: "v1",
  vehicleName: "Clio",
  type: "OIL_CHANGE",
  label: null,
  intervalKm: 10_000,
  intervalDays: 360,
  lastDoneAt: "2026-03-01",
  lastDoneKm: 40_000,
  currentKm: 49_300,
  status: "DUE",
  nextKm: 50_000,
  kmLeft: 700,
  nextDate: "2027-02-24",
  daysLeft: 93,
};

beforeEach(() => {
  mockPlans = [oil];
  for (const m of [mockCreatePlan, mockAddRecord, mockRemovePlan]) m.mockReset();
  mockCreatePlan.mockResolvedValue({});
  mockAddRecord.mockResolvedValue({});
  mockRemovePlan.mockResolvedValue(undefined);
});

describe("maintenanceDelay", () => {
  it("décrit l'échéance au kilométrage et à la date", () => {
    expect(maintenanceDelay({ status: "DUE", kmLeft: 700, daysLeft: null })).toBe("dans 700 km");
    expect(maintenanceDelay({ status: "OVERDUE", kmLeft: -300, daysLeft: null })).toBe("dépassé de 300 km");
    expect(maintenanceDelay({ status: "DUE", kmLeft: null, daysLeft: 1 })).toBe("dans 1 jour");
    expect(maintenanceDelay({ status: "OVERDUE", kmLeft: null, daysLeft: -3 })).toBe("en retard de 3 jours");
    expect(maintenanceDelay({ status: "UNKNOWN", kmLeft: null, daysLeft: null })).toBe("à compléter");
  });
});

describe("MaintenanceCard", () => {
  it("affiche les plans, leur échéance et les derniers entretiens", async () => {
    await render(<MaintenanceCard vehicleId="v1" canEdit={false} canRecord={false} />);
    expect(screen.getByText("Vidange")).toBeTruthy();
    expect(screen.getByText(/^tous les 10\s000\skm ou tous les 12 mois$/)).toBeTruthy();
    expect(screen.getByText("dans 700 km ou dans 93 jours")).toBeTruthy();
    expect(screen.getByText(/^01\/03\/2026 · Vidange · 40\s000\skm · Garage Atlas$/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ajouter" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Vidange : marquer comme fait" })).toBeNull();
  });

  it("crée un plan avec un intervalle en kilomètres et en mois", async () => {
    await render(<MaintenanceCard vehicleId="v1" canEdit canRecord />);
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Pneus" }));
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByText("Indiquez un intervalle en kilomètres, en mois, ou les deux.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Tous les (km)"), "40 000");
    await fireEvent.changeText(screen.getByLabelText("Tous les (mois)"), "24");
    await fireEvent.changeText(screen.getByLabelText("Compteur alors (km)"), "30000");
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    expect(mockCreatePlan).toHaveBeenCalledWith({ type: "TIRES", label: null, intervalKm: 40_000, intervalDays: 720, lastDoneAt: null, lastDoneKm: 30_000 });
  });

  it("enregistre un entretien fait, en exigeant le compteur pour un plan au kilométrage", async () => {
    await render(<MaintenanceCard vehicleId="v1" canEdit={false} canRecord />);
    await fireEvent.press(screen.getByRole("button", { name: "Vidange : marquer comme fait" }));
    await fireEvent.changeText(screen.getByLabelText("Vidange fait le"), "20/11/2026");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(mockAddRecord).not.toHaveBeenCalled();
    expect(screen.getByText(/Indiquez le compteur/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Compteur (km)"), "50 200");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(mockAddRecord).toHaveBeenCalledWith({ planId: "m1", doneOn: "2026-11-20", km: 50_200, garage: null, notes: null });
  });

  it("invite à compléter un plan sans référence, et laisse l'admin le supprimer", async () => {
    mockPlans = [{ ...oil, status: "UNKNOWN", lastDoneKm: null, nextKm: null, kmLeft: null, intervalDays: null, nextDate: null, daysLeft: null }];
    await render(<MaintenanceCard vehicleId="v1" canEdit canRecord />);
    expect(screen.getByText("Enregistrez le dernier entretien pour calculer le prochain.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Supprimer le plan Vidange" }));
    expect(mockRemovePlan).toHaveBeenCalledWith("m1");
  });
});
