import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import type { Zone } from "@/lib/zones";
import { ZonesScreen } from "../ZonesScreen";

let mockZones: { data?: { canEdit: boolean; zones: Zone[] }; isPending: boolean; error: unknown; refetch: jest.Mock };
const mockSave = jest.fn();
const mockRemove = jest.fn();
let mockConfirm = true;
let mockMapProps: { zones?: { id: string; draft?: boolean; radiusM: number; latitude: number }[]; onMapPress?: (p: unknown) => void } = {};

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }) }));
jest.mock("@/lib/zones", () => ({
  ...jest.requireActual("@/lib/zones"),
  useZones: () => mockZones,
  useSaveZone: () => ({ mutateAsync: mockSave, isPending: false }),
  useDeleteZone: () => ({ mutateAsync: mockRemove, isPending: false }),
}));
jest.mock("@/lib/vehicles", () => ({
  ...jest.requireActual("@/lib/vehicles"),
  useVehicles: () => ({ data: { liveDataAvailable: true, vehicles: [] } }),
}));
jest.mock("@/lib/confirm", () => ({ confirmAction: () => Promise.resolve(mockConfirm) }));
jest.mock("../../map/VehicleMap", () => ({
  VehicleMap: (props: typeof mockMapProps) => {
    mockMapProps = props;
    return null;
  },
}));

const depot: Zone = { id: "z1", name: "Dépôt", latitude: 33.57, longitude: -7.59, radiusM: 200 };

beforeEach(() => {
  mockSave.mockReset().mockResolvedValue({ zone: depot });
  mockRemove.mockReset().mockResolvedValue(undefined);
  mockConfirm = true;
  mockZones = { data: { canEdit: true, zones: [depot] }, isPending: false, error: null, refetch: jest.fn() };
});

describe("ZonesScreen", () => {
  it("liste les zones et les transmet à la carte", async () => {
    await render(<ZonesScreen />);
    expect(screen.getByText("Dépôt")).toBeTruthy();
    expect(screen.getByText("Rayon 200 m")).toBeTruthy();
    expect(mockMapProps.zones).toEqual([depot]);
    expect(mockMapProps.onMapPress).toBeUndefined();
  });

  it("en lecture seule, ne propose ni création ni modification", async () => {
    mockZones.data = { canEdit: false, zones: [depot] };
    await render(<ZonesScreen />);
    expect(screen.queryByRole("button", { name: "Nouvelle zone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Modifier Dépôt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Supprimer Dépôt" })).toBeNull();
  });

  it("crée une zone : nom, rayon et centre choisi sur la carte", async () => {
    await render(<ZonesScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Nouvelle zone" }));
    await fireEvent.changeText(screen.getByLabelText("Nom"), " Chantier ");
    await fireEvent.changeText(screen.getByLabelText("Rayon (mètres)"), "500");

    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer la zone" }));
    // La consigne et le message d'erreur portent le même texte.
    expect(screen.getAllByText("Appuyez sur la carte pour placer le centre de la zone.")).toHaveLength(2);
    expect(mockSave).not.toHaveBeenCalled();

    await act(async () => mockMapProps.onMapPress!({ latitude: 34, longitude: -6.8 }));
    expect(mockMapProps.zones!.at(-1)).toMatchObject({ draft: true, radiusM: 500, latitude: 34 });

    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer la zone" }));
    expect(mockSave).toHaveBeenCalledWith({ id: undefined, name: "Chantier", latitude: 34, longitude: -6.8, radiusM: 500 });
    expect(screen.getByRole("button", { name: "Nouvelle zone" })).toBeTruthy();
  });

  it("refuse un rayon hors bornes", async () => {
    await render(<ZonesScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Modifier Dépôt" }));
    await fireEvent.changeText(screen.getByLabelText("Rayon (mètres)"), "10");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer la zone" }));
    expect(screen.getByText("Rayon en mètres, entre 50 et 100000.")).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("modifie une zone existante et affiche le message de l'API en cas de refus", async () => {
    mockSave.mockRejectedValue(new ApiError(409, "Nombre maximal de zones atteint (50)"));
    await render(<ZonesScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Modifier Dépôt" }));
    // La zone d'origine est remplacée par son brouillon sur la carte.
    expect(mockMapProps.zones).toHaveLength(1);
    expect(mockMapProps.zones![0]).toMatchObject({ id: "z1", draft: true });
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer la zone" }));
    expect(mockSave).toHaveBeenCalledWith({ id: "z1", name: "Dépôt", latitude: 33.57, longitude: -7.59, radiusM: 200 });
    expect(screen.getByText("Nombre maximal de zones atteint (50)")).toBeTruthy();
  });

  it("supprime une zone après confirmation seulement", async () => {
    mockConfirm = false;
    await render(<ZonesScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Supprimer Dépôt" }));
    expect(mockRemove).not.toHaveBeenCalled();

    mockConfirm = true;
    await fireEvent.press(screen.getByRole("button", { name: "Supprimer Dépôt" }));
    expect(mockRemove).toHaveBeenCalledWith("z1");
  });

  it("propose de réessayer si le chargement échoue", async () => {
    mockZones = { data: undefined, isPending: false, error: new ApiError(0, "Serveur injoignable."), refetch: jest.fn() };
    await render(<ZonesScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Réessayer" }));
    expect(mockZones.refetch).toHaveBeenCalled();
  });
});
