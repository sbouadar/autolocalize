import { fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import type { Vehicle } from "@/lib/types";
import { MapScreen } from "../MapScreen";

let mockQuery: { data?: unknown; isPending: boolean; error: unknown; refetch: jest.Mock };
let mockWidth = 400;
const mockPush = jest.fn();

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/vehicles", () => ({
  ...jest.requireActual("@/lib/vehicles"),
  useVehicles: () => mockQuery,
}));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 800, scale: 1, fontScale: 1 }),
}));
// Carte simulée : un bouton par marqueur, pour vérifier ce que l'écran lui transmet.
jest.mock("../VehicleMap", () => {
  const { createElement } = jest.requireActual("react");
  const { Pressable, Text, View } = jest.requireActual("react-native");
  return {
    VehicleMap: ({ vehicles, selectedId, onSelect }: any) =>
      createElement(
        View,
        { testID: "map" },
        vehicles.map((v: any) =>
          createElement(
            Pressable,
            { key: v.id, accessibilityRole: "button", onPress: () => onSelect(v.id) },
            createElement(Text, null, `marqueur ${v.name}${v.id === selectedId ? " (sélectionné)" : ""}`),
          ),
        ),
      ),
  };
});

const position = {
  latitude: 33.57,
  longitude: -7.59,
  speedKmh: 42,
  course: 0,
  fixTime: "2026-10-28T10:00:00Z",
  address: "Bd Zerktouni, Casablanca",
  ignition: true,
  motion: true,
};

const vehicles: Vehicle[] = [
  { id: "1", name: "Utilitaire", plate: null, status: "offline", disabled: false, lastUpdate: null, position },
  { id: "2", name: "Camion", plate: "12345-A-6", status: "online", disabled: false, lastUpdate: null, position },
  { id: "3", name: "Berline", plate: null, status: "unknown", disabled: false, lastUpdate: null, position: null },
];

function loaded(data: { liveDataAvailable: boolean; vehicles: Vehicle[] }, error: unknown = null) {
  mockQuery = { data, isPending: false, error, refetch: jest.fn() };
}

beforeEach(() => {
  mockWidth = 400;
  loaded({ liveDataAvailable: true, vehicles });
});

// RNTL 14 : render et fireEvent sont asynchrones.
describe("MapScreen", () => {
  it("affiche un indicateur pendant le chargement", async () => {
    mockQuery = { data: undefined, isPending: true, error: null, refetch: jest.fn() };
    await render(<MapScreen />);
    expect(screen.getByText("Chargement des véhicules…")).toBeTruthy();
  });

  it("propose de réessayer si le premier chargement échoue", async () => {
    mockQuery = { data: undefined, isPending: false, error: new ApiError(503, "x"), refetch: jest.fn() };
    await render(<MapScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Réessayer" }));
    expect(mockQuery.refetch).toHaveBeenCalled();
  });

  it("indique quand aucun véhicule n'est rattaché", async () => {
    loaded({ liveDataAvailable: true, vehicles: [] });
    await render(<MapScreen />);
    expect(screen.getByText("Aucun véhicule")).toBeTruthy();
  });

  it("sur mobile, affiche la carte avec les seuls véhicules positionnés", async () => {
    await render(<MapScreen />);
    expect(screen.getByRole("tab", { name: "Liste (3)" })).toBeTruthy();
    expect(screen.getByText("marqueur Camion")).toBeTruthy();
    expect(screen.getByText("marqueur Utilitaire")).toBeTruthy();
    expect(screen.queryByText("marqueur Berline")).toBeNull();
  });

  it("sélectionner un véhicule dans la liste revient sur la carte et l'affiche", async () => {
    await render(<MapScreen />);
    await fireEvent.press(screen.getByRole("tab", { name: "Liste (3)" }));

    // Tri : en ligne, hors ligne, puis statut inconnu.
    const rows = screen.getAllByRole("button").map((b) => String(b.props.accessibilityLabel).split(",")[0]);
    expect(rows).toEqual(["Camion", "Utilitaire", "Berline"]);

    await fireEvent.press(screen.getByRole("button", { name: /^Camion,/ }));
    expect(screen.getByText("marqueur Camion (sélectionné)")).toBeTruthy();
    expect(screen.getByLabelText("Véhicule sélectionné : Camion")).toBeTruthy();
    expect(screen.getByText("Bd Zerktouni, Casablanca")).toBeTruthy();
    expect(screen.getByText("Contact mis")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByLabelText("Véhicule sélectionné : Camion")).toBeNull();
  });

  it("un clic sur un marqueur sélectionne le véhicule et donne accès à sa fiche", async () => {
    await render(<MapScreen />);
    await fireEvent.press(screen.getByText("marqueur Utilitaire"));
    expect(screen.getByLabelText("Véhicule sélectionné : Utilitaire")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Voir la fiche et l’historique" }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/vehicles/[id]", params: { id: "1" } });
  });

  it("filtre la liste et la carte par recherche, puis efface les filtres", async () => {
    await render(<MapScreen />);
    await fireEvent.press(screen.getByRole("tab", { name: "Liste (3)" }));
    await fireEvent.changeText(screen.getByLabelText("Rechercher un véhicule"), "6");
    expect(screen.getByRole("tab", { name: "Liste (1)" })).toBeTruthy();
    expect(screen.getByText("1 sur 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Camion,/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Utilitaire,/ })).toBeNull();

    await fireEvent.changeText(screen.getByLabelText("Rechercher un véhicule"), "zzz");
    expect(screen.getByText("Aucun véhicule ne correspond à votre recherche.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Effacer les filtres" }));
    expect(screen.getByRole("tab", { name: "Liste (3)" })).toBeTruthy();

    // Le filtre s'applique aussi aux marqueurs.
    await fireEvent.press(screen.getByRole("radio", { name: "Hors ligne" }));
    await fireEvent.press(screen.getByRole("tab", { name: "Liste (2)" }));
    await fireEvent.press(screen.getByRole("tab", { name: "Carte" }));
    expect(screen.getByText("marqueur Utilitaire")).toBeTruthy();
    expect(screen.queryByText("marqueur Camion")).toBeNull();
  });

  it("prévient quand Traccar est indisponible", async () => {
    loaded({
      liveDataAvailable: false,
      vehicles: vehicles.map((v) => ({ ...v, status: "unknown" as const, position: null })),
    });
    await render(<MapScreen />);
    expect(screen.getByText(/Suivi en direct momentanément indisponible/)).toBeTruthy();
    expect(screen.getByText("Aucune position disponible pour le moment.")).toBeTruthy();
  });

  it("garde les données affichées si un rafraîchissement échoue", async () => {
    loaded({ liveDataAvailable: true, vehicles }, new ApiError(0, "Serveur injoignable."));
    await render(<MapScreen />);
    expect(screen.getByText("Connexion perdue : les positions ne sont plus actualisées.")).toBeTruthy();
    expect(screen.getByText("marqueur Camion")).toBeTruthy();
  });

  it("sur grand écran, affiche la liste et la carte côte à côte", async () => {
    mockWidth = 1280;
    await render(<MapScreen />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByTestId("map")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Berline,/ })).toBeTruthy();
  });
});
