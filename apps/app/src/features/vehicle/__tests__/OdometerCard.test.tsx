import { fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import type { Odometer } from "@/lib/vehicle-info";
import { OdometerCard } from "../OdometerCard";

let mockQuery: { data?: Odometer; isPending: boolean; isError: boolean; refetch: jest.Mock };
const mockAdd = jest.fn();
const mockRemove = jest.fn();
const mockConfirm = jest.fn();

jest.mock("@/lib/vehicle-info", () => ({
  ...jest.requireActual("@/lib/vehicle-info"),
  useOdometer: () => mockQuery,
  useOdometerActions: () => ({
    add: { mutateAsync: mockAdd, isPending: false },
    remove: { mutateAsync: mockRemove, isPending: false },
  }),
}));
jest.mock("@/lib/confirm", () => ({ confirmAction: (...args: unknown[]) => mockConfirm(...args) }));

const base: Odometer = {
  lastReading: { km: 45_000, readAt: "2026-11-19T10:00:00Z", source: "MANUAL" },
  estimatedKm: 45_043,
  gpsKmSinceReading: 43,
  partial: false,
  unavailableReason: null,
  readings: [{ id: "r1", km: 45_000, readAt: "2026-11-19T10:00:00Z", source: "MANUAL" }],
};

const nbsp = (s: string) => s.replace(/ /g, "\u202f");

beforeEach(() => {
  mockQuery = { data: base, isPending: false, isError: false, refetch: jest.fn() };
  mockAdd.mockReset().mockResolvedValue({});
  mockRemove.mockReset().mockResolvedValue({});
  mockConfirm.mockReset().mockResolvedValue(true);
});

describe("OdometerCard", () => {
  it("affiche le compteur estimé et son calcul", async () => {
    await render(<OdometerCard vehicleId="v1" canAdd={false} canDelete={false} />);
    expect(screen.getByLabelText(`Compteur estimé : ${nbsp("45 043")} km`)).toBeTruthy();
    expect(screen.getByText(/\+ 43 km parcourus depuis \(GPS\)/)).toBeTruthy();
    // Lecture seule : ni saisie, ni suppression.
    expect(screen.queryByLabelText("Nouveau relevé (km)")).toBeNull();
    expect(screen.queryByRole("button", { name: /Supprimer le relevé/ })).toBeNull();
  });

  it("sans relevé, invite l'admin à saisir le compteur", async () => {
    mockQuery.data = { ...base, lastReading: null, estimatedKm: null, gpsKmSinceReading: null, readings: [] };
    await render(<OdometerCard vehicleId="v1" canAdd canDelete />);
    expect(screen.getByText(/Aucun relevé : saisissez le kilométrage/)).toBeTruthy();
  });

  it("signale une estimation impossible faute de Traccar, avec le dernier relevé", async () => {
    mockQuery.data = { ...base, estimatedKm: null, gpsKmSinceReading: null, unavailableReason: "TRACCAR_UNAVAILABLE" };
    await render(<OdometerCard vehicleId="v1" canAdd={false} canDelete={false} />);
    expect(screen.getByLabelText(`Compteur estimé : ${nbsp("45 000")} km`)).toBeTruthy();
    expect(screen.getByText(/Distance GPS momentanément indisponible/)).toBeTruthy();
  });

  it("enregistre un relevé saisi avec des espaces, et refuse une saisie non numérique", async () => {
    await render(<OdometerCard vehicleId="v1" canAdd canDelete />);
    await fireEvent.changeText(screen.getByLabelText("Nouveau relevé (km)"), "abc");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(mockAdd).not.toHaveBeenCalled();
    expect(screen.getByText(/en chiffres/)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("Nouveau relevé (km)"), "46 100");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(mockAdd).toHaveBeenCalledWith(46_100);
  });

  it("affiche le refus de l'API quand le compteur recule", async () => {
    mockAdd.mockRejectedValue(new ApiError(409, "Le compteur ne peut pas reculer : un relevé antérieur indique déjà 45000 km", "ODOMETER_DECREASE"));
    await render(<OdometerCard vehicleId="v1" canAdd canDelete />);
    await fireEvent.changeText(screen.getByLabelText("Nouveau relevé (km)"), "1000");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(screen.getByText(/Le compteur ne peut pas reculer/)).toBeTruthy();
  });

  it("laisse l'agent saisir un relevé sans pouvoir en supprimer", async () => {
    await render(<OdometerCard vehicleId="v1" canAdd canDelete={false} />);
    expect(screen.getByLabelText("Nouveau relevé (km)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Supprimer le relevé/ })).toBeNull();
  });

  it("supprime un relevé après confirmation", async () => {
    await render(<OdometerCard vehicleId="v1" canAdd canDelete />);
    await fireEvent.press(screen.getByRole("button", { name: `Supprimer le relevé de ${nbsp("45 000")} km` }));
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockRemove).toHaveBeenCalledWith("r1");
  });
});
