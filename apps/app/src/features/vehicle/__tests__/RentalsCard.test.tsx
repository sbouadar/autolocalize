import { fireEvent, render, screen } from "@testing-library/react-native";
import type { Rental } from "@/lib/rentals";
import { RentalsCard } from "../RentalsCard";

const mockPush = jest.fn();
let mockRentals: Rental[];
let mockArgs: unknown;

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/lib/rentals", () => ({
  ...jest.requireActual("@/lib/rentals"),
  useRentals: (args: unknown) => {
    mockArgs = args;
    return { data: { rentals: mockRentals }, isPending: false, isError: false };
  },
}));

const rental = (overrides: Partial<Rental>): Rental => ({
  id: "r1",
  status: "RESERVED",
  vehicleId: "v1",
  vehicleName: "Clio",
  vehiclePlate: null,
  customerId: "c1",
  customerName: "Karim Alaoui",
  customerPhone: null,
  driverName: null,
  startAt: "2026-12-01T09:00:00Z",
  endAt: "2026-12-03T09:00:00Z",
  pickedUpAt: null,
  returnedAt: null,
  odometerOutKm: null,
  odometerInKm: null,
  fuelOut: null,
  fuelIn: null,
  gpsDistanceKm: null,
  price: null,
  deposit: null,
  currency: "MAD",
  allowedZoneId: null,
  pickupLocation: null,
  returnLocation: null,
  notes: null,
  late: false,
  ...overrides,
});

beforeEach(() => {
  mockPush.mockReset();
  mockRentals = [];
});

describe("RentalsCard", () => {
  it("liste les locations du véhicule : en cours, puis à venir, puis passées, sans les annulées", async () => {
    mockRentals = [
      rental({ id: "past", status: "COMPLETED", customerName: "Ancien", startAt: "2026-11-01T09:00:00Z" }),
      rental({ id: "later", customerName: "Plus tard", startAt: "2026-12-20T09:00:00Z" }),
      rental({ id: "soon", customerName: "Bientôt", startAt: "2026-12-01T09:00:00Z" }),
      rental({ id: "now", status: "ONGOING", customerName: "En route" }),
      rental({ id: "x", status: "CANCELLED", customerName: "Annulé" }),
    ];
    await render(<RentalsCard vehicleId="v1" canBook />);
    expect(mockArgs).toEqual({ vehicleId: "v1" });
    const names = screen.getAllByRole("button", { name: /Ouvrir la location/ }).map((b) => b.props.accessibilityLabel.split(",")[1].trim());
    expect(names).toEqual(["En route", "Bientôt", "Plus tard", "Ancien"]);
    await fireEvent.press(screen.getByRole("button", { name: /Bientôt/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/rentals/[id]", params: { id: "soon" } });
    await fireEvent.press(screen.getByRole("button", { name: "Réserver" }));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/rentals/new", params: { vehicleId: "v1" } });
  });

  it("ne propose pas de réserver à un compte en consultation", async () => {
    await render(<RentalsCard vehicleId="v1" canBook={false} />);
    expect(screen.getByText("Aucune location en cours, à venir ou récente.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Réserver" })).toBeNull();
  });
});
