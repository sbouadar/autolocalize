import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import type { Vehicle } from "@/lib/types";
import { clearZoneSelection } from "@/lib/zone-selection";
import { formatRadius, parseRadiusKm, radiusToKmText, type Zone } from "@/lib/zones";
import { ZonesScreen } from "../ZonesScreen";

let mockZones: { data?: { canEdit: boolean; zones: Zone[] }; isPending: boolean; error: unknown; refetch: jest.Mock };
let mockVehicles: Vehicle[];
const mockSave = jest.fn();
const mockRemove = jest.fn();
let mockConfirm = true;
let mockMapProps: {
  zones?: { id: string; draft?: boolean; radiusM: number; latitude: number; color: string }[];
  onMapPress?: (p: unknown) => void;
} = {};

jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }) }));
jest.mock("@/lib/zones", () => ({
  ...jest.requireActual("@/lib/zones"),
  useZones: () => mockZones,
  useSaveZone: () => ({ mutateAsync: mockSave, isPending: false }),
  useDeleteZone: () => ({ mutateAsync: mockRemove, isPending: false }),
}));
jest.mock("@/lib/vehicles", () => ({
  ...jest.requireActual("@/lib/vehicles"),
  useVehicles: () => ({ data: { liveDataAvailable: true, vehicles: mockVehicles } }),
}));
jest.mock("@/lib/confirm", () => ({ confirmAction: () => Promise.resolve(mockConfirm) }));
jest.mock("../../map/VehicleMap", () => ({
  VehicleMap: (props: typeof mockMapProps) => {
    mockMapProps = props;
    return null;
  },
}));

const vehicle = (id: string, name: string): Vehicle => ({
  id,
  name,
  plate: null,
  status: "online",
  disabled: false,
  lastUpdate: null,
  position: null,
});
const depot: Zone = { id: "z1", name: "Dépôt", latitude: 33.57, longitude: -7.59, radiusM: 20_000, color: "#DC2626", vehicleIds: ["v1"] };

beforeEach(() => {
  clearZoneSelection();
  mockSave.mockReset().mockResolvedValue({ zone: depot });
  mockRemove.mockReset().mockResolvedValue(undefined);
  mockConfirm = true;
  mockVehicles = [vehicle("v1", "Camion"), vehicle("v2", "Fourgon")];
  mockZones = { data: { canEdit: true, zones: [depot] }, isPending: false, error: null, refetch: jest.fn() };
});

describe("rayon en kilomètres", () => {
  it("lit et affiche le rayon en kilomètres", () => {
    expect(parseRadiusKm("20")).toBe(20_000);
    expect(parseRadiusKm("0,2")).toBe(200);
    expect(parseRadiusKm(" 1.5 ")).toBe(1_500);
    expect(parseRadiusKm("0,01")).toBeNull();
    expect(parseRadiusKm("150")).toBeNull();
    expect(parseRadiusKm("vingt")).toBeNull();
    expect(radiusToKmText(20_000)).toBe("20");
    expect(radiusToKmText(200)).toBe("0,2");
    expect(formatRadius(25_000)).toBe("25 km");
  });
});

describe("ZonesScreen", () => {
  it("n'affiche une zone sur la carte que si elle est cochée, dans sa couleur", async () => {
    await render(<ZonesScreen />);
    expect(screen.getByText("Rayon 20 km · 1 véhicule surveillé")).toBeTruthy();
    expect(mockMapProps.zones).toEqual([]);

    await fireEvent.press(screen.getByRole("checkbox", { name: "Afficher Dépôt sur la carte" }));
    expect(mockMapProps.zones).toHaveLength(1);
    expect(mockMapProps.zones![0]).toMatchObject({ id: "z1", color: "#DC2626" });

    await fireEvent.press(screen.getByRole("checkbox", { name: "Afficher Dépôt sur la carte" }));
    expect(mockMapProps.zones).toEqual([]);
    expect(mockMapProps.onMapPress).toBeUndefined();
  });

  it("en lecture seule, ne propose ni création ni modification", async () => {
    mockZones.data = { canEdit: false, zones: [depot] };
    await render(<ZonesScreen />);
    expect(screen.queryByRole("button", { name: "Nouvelle zone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Modifier Dépôt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Supprimer Dépôt" })).toBeNull();
  });

  it("crée une zone : nom, rayon en km, centre sur la carte et véhicules surveillés", async () => {
    await render(<ZonesScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Nouvelle zone" }));
    await fireEvent.changeText(screen.getByLabelText("Nom"), " Rabat ");
    await fireEvent.changeText(screen.getByLabelText("Rayon (kilomètres)"), "2,5");
    await fireEvent.press(screen.getByRole("checkbox", { name: "Fourgon" }));

    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer la zone" }));
    // La consigne et le message d'erreur portent le même texte.
    expect(screen.getAllByText("Appuyez sur la carte pour placer le centre de la zone.")).toHaveLength(2);
    expect(mockSave).not.toHaveBeenCalled();

    await act(async () => mockMapProps.onMapPress!({ latitude: 34, longitude: -6.8 }));
    expect(mockMapProps.zones!.at(-1)).toMatchObject({ draft: true, radiusM: 2_500, latitude: 34 });

    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer la zone" }));
    expect(mockSave).toHaveBeenCalledWith({ id: undefined, name: "Rabat", latitude: 34, longitude: -6.8, radiusM: 2_500, vehicleIds: ["v2"] });
    expect(screen.getByRole("button", { name: "Nouvelle zone" })).toBeTruthy();
    // La zone enregistrée est affichée sur la carte.
    expect(mockMapProps.zones!.map((z) => z.id)).toEqual(["z1"]);
  });

  it("refuse un rayon hors bornes", async () => {
    await render(<ZonesScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Modifier Dépôt" }));
    expect(screen.getByLabelText("Rayon (kilomètres)").props.value).toBe("20");
    await fireEvent.changeText(screen.getByLabelText("Rayon (kilomètres)"), "500");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer la zone" }));
    expect(screen.getByText("Rayon en kilomètres, entre 0,05 et 100.")).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("modifie les véhicules d'une zone et affiche le message de l'API en cas de refus", async () => {
    mockSave.mockRejectedValue(new ApiError(409, "« Fourgon » est déjà surveillé par 5 zones (maximum)"));
    await render(<ZonesScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Modifier Dépôt" }));
    // La zone d'origine est remplacée par son brouillon sur la carte.
    expect(mockMapProps.zones).toHaveLength(1);
    expect(mockMapProps.zones![0]).toMatchObject({ id: "z1", draft: true, color: "#DC2626" });
    expect(screen.getByRole("checkbox", { name: "Camion" }).props.accessibilityState).toMatchObject({ checked: true });

    await fireEvent.press(screen.getByRole("checkbox", { name: "Camion" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Fourgon" }));
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer la zone" }));
    expect(mockSave).toHaveBeenCalledWith({ id: "z1", name: "Dépôt", latitude: 33.57, longitude: -7.59, radiusM: 20_000, vehicleIds: ["v2"] });
    expect(screen.getByText("« Fourgon » est déjà surveillé par 5 zones (maximum)")).toBeTruthy();
  });

  it("empêche de cocher un véhicule déjà surveillé par cinq zones", async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ ...depot, id: `z${i + 1}`, name: `Zone ${i + 1}`, vehicleIds: ["v2"] }));
    mockZones.data = { canEdit: true, zones: five };
    await render(<ZonesScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Nouvelle zone" }));
    expect(screen.getByRole("checkbox", { name: "Fourgon" }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText("Déjà surveillé par 5 zones (maximum)")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Camion" }).props.accessibilityState).toMatchObject({ disabled: false });
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
