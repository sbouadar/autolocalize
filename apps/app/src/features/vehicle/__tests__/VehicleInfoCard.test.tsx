import { fireEvent, render, screen } from "@testing-library/react-native";
import { VehicleInfoCard } from "../VehicleInfoCard";

const mockUpdate = jest.fn();
jest.mock("@/lib/vehicle-info", () => ({
  ...jest.requireActual("@/lib/vehicle-info"),
  useUpdateVehicleInfo: () => ({ mutateAsync: mockUpdate, isPending: false }),
}));

const vehicle = {
  id: "v1",
  name: "Clio 5",
  plate: "12345-A-6",
  details: { brand: "Renault", model: "Clio", year: 2022, vin: null, fuelType: "DIESEL" as const, color: null, notes: "Rayure" },
};

beforeEach(() => mockUpdate.mockReset().mockResolvedValue({}));

describe("VehicleInfoCard", () => {
  it("affiche les informations renseignées, sans bouton en lecture seule", async () => {
    await render(<VehicleInfoCard vehicle={vehicle} canEdit={false} />);
    expect(screen.getByText("Renault Clio")).toBeTruthy();
    expect(screen.getByText("2022")).toBeTruthy();
    expect(screen.getByText("Diesel")).toBeTruthy();
    expect(screen.getByText("Rayure")).toBeTruthy();
    expect(screen.queryByText("N° de série (VIN)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull();
  });

  it("permet à l'admin de modifier la fiche", async () => {
    await render(<VehicleInfoCard vehicle={vehicle} canEdit />);
    await fireEvent.press(screen.getByRole("button", { name: "Modifier" }));
    await fireEvent.changeText(screen.getByLabelText("Couleur"), "Blanc");
    await fireEvent.press(screen.getByRole("radio", { name: "Hybride" }));
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Clio 5", brand: "Renault", year: 2022, color: "Blanc", fuelType: "HYBRID" }),
    );
    expect(screen.getByRole("button", { name: "Modifier" })).toBeTruthy();
  });

  it("refuse une année mal saisie et un nom vide", async () => {
    await render(<VehicleInfoCard vehicle={vehicle} canEdit />);
    await fireEvent.press(screen.getByRole("button", { name: "Modifier" }));
    await fireEvent.changeText(screen.getByLabelText("Année"), "22");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(screen.getByText("L’année doit comporter 4 chiffres.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Année"), "");
    await fireEvent.changeText(screen.getByLabelText("Nom"), " ");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(screen.getByText("Le nom du véhicule est obligatoire.")).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
