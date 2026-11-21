import { fireEvent, render, screen } from "@testing-library/react-native";
import type { Deadline } from "@/lib/fleet-care";
import { DeadlinesCard } from "../DeadlinesCard";

const mockCreate = jest.fn();
const mockRenew = jest.fn();
const mockRemove = jest.fn();
const mockConfirm = jest.fn();
let mockDeadlines: Deadline[];

jest.mock("@/lib/fleet-care", () => ({
  ...jest.requireActual("@/lib/fleet-care"),
  useVehicleDeadlines: () => ({ data: { deadlines: mockDeadlines }, isPending: false, isError: false, refetch: jest.fn() }),
  useDeadlineActions: () => ({ create: { mutateAsync: mockCreate, isPending: false }, renew: mockRenew, remove: mockRemove }),
}));
jest.mock("@/lib/confirm", () => ({ confirmAction: (...args: unknown[]) => mockConfirm(...args) }));

const insurance: Deadline = {
  id: "d1",
  vehicleId: "v1",
  vehicleName: "Clio",
  vehiclePlate: null,
  type: "INSURANCE",
  label: null,
  expiresOn: "2026-12-02",
  reference: "POL-123",
  warnDaysBefore: 30,
  notes: null,
  daysLeft: 10,
  status: "WARNING",
};

beforeEach(() => {
  mockDeadlines = [insurance];
  for (const m of [mockCreate, mockRenew, mockRemove, mockConfirm]) m.mockReset();
  mockCreate.mockResolvedValue({});
  mockRenew.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
  mockConfirm.mockResolvedValue(true);
});

describe("DeadlinesCard", () => {
  it("affiche les échéances et leur délai, sans action en lecture seule", async () => {
    await render(<DeadlinesCard vehicleId="v1" canEdit={false} />);
    expect(screen.getByText("Assurance")).toBeTruthy();
    expect(screen.getByText("02/12/2026 · POL-123")).toBeTruthy();
    expect(screen.getByText("expire dans 10 jours")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ajouter" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Renouveler Assurance" })).toBeNull();
  });

  it("ajoute une échéance avec une date saisie en JJ/MM/AAAA", async () => {
    await render(<DeadlinesCard vehicleId="v1" canEdit />);
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Vignette" }));
    await fireEvent.changeText(screen.getByLabelText("Date d’expiration (JJ/MM/AAAA)"), "31/02/2027");
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.getByText("Saisissez la date d’expiration au format JJ/MM/AAAA.")).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("Date d’expiration (JJ/MM/AAAA)"), "31/01/2027");
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    expect(mockCreate).toHaveBeenCalledWith({ type: "ROAD_TAX", label: null, expiresOn: "2027-01-31", reference: null });
  });

  it("exige un nom pour une échéance « autre »", async () => {
    await render(<DeadlinesCard vehicleId="v1" canEdit />);
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Autre" }));
    await fireEvent.changeText(screen.getByLabelText("Date d’expiration (JJ/MM/AAAA)"), "31/01/2027");
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByText("Précisez le nom de l’échéance.")).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("renouvelle et supprime une échéance", async () => {
    await render(<DeadlinesCard vehicleId="v1" canEdit />);
    await fireEvent.press(screen.getByRole("button", { name: "Renouveler Assurance" }));
    await fireEvent.changeText(screen.getByLabelText("Nouvelle date pour Assurance"), "02/12/2027");
    await fireEvent.press(screen.getByRole("button", { name: "Valider" }));
    expect(mockRenew).toHaveBeenCalledWith("d1", "2027-12-02");

    await fireEvent.press(screen.getByRole("button", { name: "Supprimer Assurance" }));
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledWith("d1");
  });
});
