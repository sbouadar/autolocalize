import { fireEvent, render, screen } from "@testing-library/react-native";
import type { Unavailability } from "@/lib/fleet-care";
import { UnavailabilityCard } from "../UnavailabilityCard";

const mockCreate = jest.fn();
const mockEnd = jest.fn();
const mockRemove = jest.fn();
let mockList: Unavailability[];

jest.mock("@/lib/fleet-care", () => ({
  ...jest.requireActual("@/lib/fleet-care"),
  useVehicleUnavailabilities: () => ({ data: { unavailabilities: mockList }, isPending: false, isError: false, refetch: jest.fn() }),
  useUnavailabilityActions: () => ({ create: { mutateAsync: mockCreate, isPending: false }, end: mockEnd, remove: mockRemove }),
}));
jest.mock("@/lib/confirm", () => ({ confirmAction: async () => true }));

const repair: Unavailability = {
  id: "u1",
  vehicleId: "v1",
  vehicleName: "Clio",
  vehiclePlate: null,
  startAt: "2026-11-20T08:00:00Z",
  endAt: null,
  reason: "REPAIR",
  notes: "Embrayage",
  current: true,
  past: false,
};

beforeEach(() => {
  mockList = [];
  for (const m of [mockCreate, mockEnd, mockRemove]) m.mockReset();
  mockCreate.mockResolvedValue({});
  mockEnd.mockResolvedValue(undefined);
});

describe("UnavailabilityCard", () => {
  it("indique un véhicule disponible", async () => {
    await render(<UnavailabilityCard vehicleId="v1" canEdit={false} />);
    expect(screen.getByText("Disponible")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Immobiliser" })).toBeNull();
  });

  it("montre l'immobilisation en cours et permet de remettre en service", async () => {
    mockList = [repair];
    await render(<UnavailabilityCard vehicleId="v1" canEdit />);
    expect(screen.getByText("Indisponible : réparation")).toBeTruthy();
    expect(screen.getByText(/jusqu’à nouvel ordre · Embrayage/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Remettre en service (Réparation)" }));
    expect(mockEnd).toHaveBeenCalledWith("u1");
  });

  it("immobilise un véhicule sur une période, et refuse une fin avant le début", async () => {
    await render(<UnavailabilityCard vehicleId="v1" canEdit />);
    await fireEvent.press(screen.getByRole("button", { name: "Immobiliser" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Accident" }));
    await fireEvent.changeText(screen.getByLabelText("Du (JJ/MM/AAAA)"), "10/12/2026");
    await fireEvent.changeText(screen.getByLabelText("Au (facultatif)"), "05/12/2026");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(screen.getByText("La date de fin doit être après la date de début.")).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("Au (facultatif)"), "12/12/2026");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    const sent = mockCreate.mock.calls[0]![0];
    expect(sent.reason).toBe("ACCIDENT");
    expect(sent.notes).toBeNull();
    // Du début du 10 à la fin du 12 (heure locale) : 3 jours.
    expect(Date.parse(sent.endAt) - Date.parse(sent.startAt)).toBe(3 * 86_400_000);
  });
});
