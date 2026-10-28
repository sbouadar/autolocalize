import { fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import type { Trip, Vehicle } from "@/lib/types";
import { VehicleDetailScreen } from "../VehicleDetailScreen";

type Query = { data?: unknown; isPending: boolean; isError?: boolean; error: unknown; refetch: jest.Mock };
let mockVehicle: Query;
let mockTrips: Query;
let mockRoute: Query;
const mockTripsCalls: unknown[] = [];
const mockBack = jest.fn();
let mockMapProps: { route?: unknown[] } = {};

jest.mock("@/lib/vehicles", () => ({
  ...jest.requireActual("@/lib/vehicles"),
  useVehicle: () => mockVehicle,
  useTrips: (_id: string, range: unknown) => {
    mockTripsCalls.push(range);
    return mockTrips;
  },
  useRoute: () => mockRoute,
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, canGoBack: () => true, replace: jest.fn() }),
}));
jest.mock("../../map/VehicleMap", () => ({
  VehicleMap: (props: { route?: unknown[] }) => {
    mockMapProps = props;
    return null;
  },
}));

const vehicle: Vehicle = {
  id: "v1",
  name: "Camion 1",
  plate: "12345-A-6",
  status: "online",
  disabled: false,
  lastUpdate: "2026-10-28T10:00:00Z",
  position: {
    latitude: 33.57,
    longitude: -7.59,
    speedKmh: 0,
    course: 0,
    fixTime: "2026-10-28T10:00:00Z",
    address: "Port de Casablanca",
    ignition: false,
    motion: false,
  },
};

const trip = (start: string, end: string, distanceKm: number): Trip => ({
  startTime: start,
  endTime: end,
  durationMs: Date.parse(end) - Date.parse(start),
  distanceKm,
  averageSpeedKmh: 30,
  maxSpeedKmh: 70,
  start: { latitude: 0, longitude: 0, address: "Dépôt" },
  end: { latitude: 0, longitude: 0, address: null },
});

const point = (fixTime: string) => ({ latitude: 33, longitude: -7, speedKmh: 10, fixTime });

const ok = (data: unknown): Query => ({ data, isPending: false, isError: false, error: null, refetch: jest.fn() });

beforeEach(() => {
  mockTripsCalls.length = 0;
  mockVehicle = ok({ liveDataAvailable: true, vehicle });
  mockTrips = ok({
    trips: [
      trip("2026-10-28T08:00:00Z", "2026-10-28T08:30:00Z", 12.3),
      trip("2026-10-28T09:00:00Z", "2026-10-28T10:00:00Z", 40),
    ],
  });
  mockRoute = ok({
    truncated: false,
    points: [point("2026-10-28T08:10:00Z"), point("2026-10-28T09:10:00Z"), point("2026-10-28T09:20:00Z")],
  });
});

describe("VehicleDetailScreen", () => {
  it("affiche l'état du véhicule", async () => {
    await render(<VehicleDetailScreen id="v1" />);
    expect(screen.getByText("Camion 1")).toBeTruthy();
    expect(screen.getByText("12345-A-6")).toBeTruthy();
    expect(screen.getByText("En ligne")).toBeTruthy();
    expect(screen.getByText("Contact coupé")).toBeTruthy();
    expect(screen.getByText("Port de Casablanca")).toBeTruthy();
  });

  it("affiche les totaux et les trajets de la période", async () => {
    await render(<VehicleDetailScreen id="v1" />);
    expect(screen.getByLabelText("Trajets : 2")).toBeTruthy();
    expect(screen.getByLabelText(/^Distance : 52,3\s?km$/)).toBeTruthy();
    expect(screen.getByLabelText("Temps de conduite : 1 h 30")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Trajet / })).toHaveLength(2);
  });

  it("isole le trajet choisi sur la carte, puis revient au tracé complet", async () => {
    await render(<VehicleDetailScreen id="v1" />);
    expect(mockMapProps.route).toHaveLength(3);
    const [first] = screen.getAllByRole("button", { name: /^Trajet / });
    await fireEvent.press(first!);
    expect(mockMapProps.route).toHaveLength(1);
    await fireEvent.press(screen.getAllByRole("button", { name: /^Trajet / })[0]!);
    expect(mockMapProps.route).toHaveLength(3);
  });

  it("change de période", async () => {
    await render(<VehicleDetailScreen id="v1" />);
    const before = mockTripsCalls.at(-1);
    await fireEvent.press(screen.getByRole("radio", { name: "Hier" }));
    expect(mockTripsCalls.at(-1)).not.toEqual(before);
    expect(screen.getByRole("radio", { name: "Hier" }).props.accessibilityState).toMatchObject({ checked: true });
  });

  it("indique l'absence de trajet", async () => {
    mockTrips = ok({ trips: [] });
    await render(<VehicleDetailScreen id="v1" />);
    expect(screen.getByText("Aucun trajet sur cette période.")).toBeTruthy();
  });

  it("signale un véhicule introuvable ou d'un autre client", async () => {
    mockVehicle = { data: undefined, isPending: false, error: new ApiError(404, "Not Found"), refetch: jest.fn() };
    await render(<VehicleDetailScreen id="autre" />);
    expect(screen.getByText("Véhicule introuvable")).toBeTruthy();
    await fireEvent.press(screen.getByRole("link", { name: "‹ Retour" }));
    expect(mockBack).toHaveBeenCalled();
  });

  it("propose de réessayer si l'historique est indisponible", async () => {
    mockTrips = { data: undefined, isPending: false, isError: true, error: new ApiError(503, "x"), refetch: jest.fn() };
    await render(<VehicleDetailScreen id="v1" />);
    await fireEvent.press(screen.getByRole("button", { name: "Réessayer" }));
    expect(mockTrips.refetch).toHaveBeenCalled();
  });
});
