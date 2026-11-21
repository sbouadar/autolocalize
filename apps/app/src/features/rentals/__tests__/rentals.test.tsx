import { fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import type { Customer, Rental, VehicleAvailability } from "@/lib/rentals";
import { CustomerDetailScreen } from "../CustomerDetailScreen";
import { NewRentalScreen } from "../NewRentalScreen";
import { RentalDetailScreen } from "../RentalDetailScreen";
import { RentalsScreen } from "../RentalsScreen";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockConfirm = jest.fn();
const mockCreateRental = jest.fn();
const mockCancel = jest.fn();
const mockReveal = jest.fn();
const mockAnonymize = jest.fn();
let mockRole = "TENANT_ADMIN";
let mockEnabled = true;
let mockRentals: Rental[];
let mockCustomers: Customer[];
let mockAvailability: VehicleAvailability[];
let mockAvailabilityArgs: (string | null)[] = [];

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{`redirection ${href}`}</Text>;
  },
}));
jest.mock("@/lib/auth", () => ({
  useAuth: () => ({ me: { user: { role: mockRole }, tenant: { rentalsEnabled: mockEnabled, currency: "MAD" } } }),
}));
jest.mock("@/lib/confirm", () => ({ confirmAction: (...args: unknown[]) => mockConfirm(...args) }));
jest.mock("@/lib/vehicles", () => ({ ...jest.requireActual("@/lib/vehicles"), useVehicles: () => ({ data: { vehicles: [] } }) }));
jest.mock("@/lib/rentals", () => ({
  ...jest.requireActual("@/lib/rentals"),
  useRentals: () => ({ data: { rentals: mockRentals }, isPending: false, error: null, refetch: jest.fn() }),
  useRental: (id: string) => {
    const rental = mockRentals.find((r) => r.id === id);
    return { data: rental ? { rental } : undefined, isPending: false, error: rental ? null : new (jest.requireActual("@/lib/api").ApiError)(404, "x"), refetch: jest.fn() };
  },
  useCustomers: () => ({ data: { customers: mockCustomers }, isPending: false, error: null, refetch: jest.fn() }),
  useCustomer: (id: string) => {
    const customer = mockCustomers.find((c) => c.id === id);
    return { data: customer ? { customer } : undefined, isPending: false, error: null, refetch: jest.fn() };
  },
  useAvailability: (from: string | null, to: string | null) => {
    mockAvailabilityArgs = [from, to];
    return { data: from && to ? { vehicles: mockAvailability } : undefined, isPending: false, isError: false, refetch: jest.fn() };
  },
  useRentalActions: () => ({
    create: { mutateAsync: mockCreateRental, isPending: false },
    update: { mutateAsync: jest.fn(), isPending: false },
    cancel: mockCancel,
  }),
  useCustomerActions: () => ({
    create: { mutateAsync: jest.fn(), isPending: false },
    update: { mutateAsync: jest.fn(), isPending: false },
    revealIdentity: mockReveal,
    anonymize: mockAnonymize,
  }),
}));

const rental = (overrides: Partial<Rental>): Rental => ({
  id: "r1",
  status: "RESERVED",
  vehicleId: "v1",
  vehicleName: "Clio",
  vehiclePlate: "1-A-1",
  customerId: "c1",
  customerName: "Karim Alaoui",
  customerPhone: "+212600000001",
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
  price: "1200.50",
  deposit: null,
  currency: "MAD",
  allowedZoneId: null,
  notes: null,
  late: false,
  ...overrides,
});

const karim: Customer = {
  id: "c1",
  kind: "PERSON",
  name: "Karim Alaoui",
  phone: "+212600000001",
  email: null,
  address: null,
  birthDate: null,
  idDocumentType: "NATIONAL_ID",
  idDocumentMasked: "••••3456",
  licenseMasked: null,
  licenseExpiresOn: null,
  anonymized: false,
  notes: null,
};

beforeEach(() => {
  mockRole = "TENANT_ADMIN";
  mockEnabled = true;
  mockRentals = [rental({}), rental({ id: "r2", status: "ONGOING", late: true, vehicleName: "Master" })];
  mockCustomers = [karim];
  mockAvailability = [
    { id: "v1", name: "Clio", plate: "1-A-1", available: true, reason: null },
    { id: "v2", name: "Master", plate: null, available: false, reason: "RENTED" },
  ];
  for (const m of [mockPush, mockReplace, mockConfirm, mockCreateRental, mockCancel, mockReveal, mockAnonymize]) m.mockReset();
  mockConfirm.mockResolvedValue(true);
  mockCancel.mockResolvedValue(undefined);
});

describe("RentalsScreen", () => {
  it("classe les locations et signale un retard", async () => {
    await render(<RentalsScreen />);
    expect(screen.getByText("En cours (1)")).toBeTruthy();
    expect(screen.getByText("À venir (1)")).toBeTruthy();
    expect(screen.getByText("En retard")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Clio, Karim Alaoui, Réservée/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/rentals/[id]", params: { id: "r1" } });
  });

  it("ne propose pas de réserver à un compte en consultation", async () => {
    mockRole = "VIEWER";
    await render(<RentalsScreen />);
    expect(screen.queryByRole("button", { name: "Nouvelle réservation" })).toBeNull();
    expect(screen.getByText("En cours (1)")).toBeTruthy();
  });

  it("renvoie à l'accueil si le module location n'est pas activé", async () => {
    mockEnabled = false;
    await render(<RentalsScreen />);
    expect(screen.getByText("redirection /")).toBeTruthy();
  });
});

describe("NewRentalScreen", () => {
  it("enchaîne période, véhicule libre, locataire et prix", async () => {
    mockCreateRental.mockResolvedValue({ rental: rental({ id: "r9" }) });
    await render(<NewRentalScreen />);
    await fireEvent.changeText(screen.getByLabelText("Départ (JJ/MM/AAAA)"), "01/12/2026");
    await fireEvent.changeText(screen.getByLabelText("Retour (JJ/MM/AAAA)"), "30/11/2026");
    await fireEvent.press(screen.getByRole("button", { name: "Voir les véhicules libres" }));
    expect(screen.getByText("Le retour doit être après le départ.")).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("Retour (JJ/MM/AAAA)"), "03/12/2026");
    await fireEvent.press(screen.getByRole("button", { name: "Voir les véhicules libres" }));
    expect(mockAvailabilityArgs.every(Boolean)).toBe(true);
    // Le véhicule déjà loué n'est pas sélectionnable.
    expect(screen.getByRole("radio", { name: "Master, déjà loué" }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByRole("radio", { name: "Clio" }));
    await fireEvent.press(screen.getByRole("button", { name: "Choisir Karim Alaoui" }));
    await fireEvent.changeText(screen.getByLabelText("Prix (MAD)"), "1 200,50");
    await fireEvent.press(screen.getByRole("button", { name: "Créer la réservation" }));

    const sent = mockCreateRental.mock.calls[0]![0];
    expect(sent).toMatchObject({ vehicleId: "v1", customerId: "c1", price: 1200.5, deposit: null, notes: null });
    expect(Date.parse(sent.endAt) - Date.parse(sent.startAt)).toBe(2 * 86_400_000);
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/rentals/[id]", params: { id: "r9" } });
  });

  it("affiche le refus quand le véhicule vient d'être réservé par quelqu'un d'autre", async () => {
    mockCreateRental.mockRejectedValue(new ApiError(409, "Ce véhicule est déjà réservé sur cette période", "RENTAL_OVERLAP"));
    await render(<NewRentalScreen />);
    await fireEvent.changeText(screen.getByLabelText("Retour (JJ/MM/AAAA)"), "31/12/2030");
    await fireEvent.press(screen.getByRole("button", { name: "Voir les véhicules libres" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Clio" }));
    await fireEvent.press(screen.getByRole("button", { name: "Choisir Karim Alaoui" }));
    await fireEvent.press(screen.getByRole("button", { name: "Créer la réservation" }));
    expect(screen.getByText("Ce véhicule est déjà réservé sur cette période")).toBeTruthy();
  });

  it("est fermé aux comptes en consultation", async () => {
    mockRole = "VIEWER";
    await render(<NewRentalScreen />);
    expect(screen.getByText("redirection /")).toBeTruthy();
  });
});

describe("RentalDetailScreen", () => {
  it("affiche la location et annule une réservation après confirmation", async () => {
    await render(<RentalDetailScreen id="r1" />);
    expect(screen.getByText("Karim Alaoui")).toBeTruthy();
    expect(screen.getByText(/1\s200,5\sDH/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Annuler la réservation" }));
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockCancel).toHaveBeenCalledWith("r1");
  });

  it("signale le retard et n'offre pas d'annuler une location partie", async () => {
    await render(<RentalDetailScreen id="r2" />);
    expect(screen.getByText(/Retour en retard/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Annuler la réservation" })).toBeNull();
  });

  it("n'offre aucune modification en consultation", async () => {
    mockRole = "VIEWER";
    await render(<RentalDetailScreen id="r1" />);
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Annuler la réservation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Voir la fiche" })).toBeNull();
  });
});

describe("CustomerDetailScreen", () => {
  it("masque le numéro de pièce et ne l'affiche complet que sur demande", async () => {
    mockReveal.mockResolvedValue({ idDocumentNumber: "BK123456", licenseNumber: null });
    await render(<CustomerDetailScreen id="c1" />);
    expect(screen.getByText("••••3456")).toBeTruthy();
    expect(screen.queryByText("BK123456")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Afficher les numéros complets" }));
    expect(mockReveal).toHaveBeenCalledWith("c1");
    expect(screen.getByText("BK123456")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Masquer les numéros" }));
    expect(screen.queryByText("BK123456")).toBeNull();
  });

  it("réserve l'anonymisation à l'admin, après confirmation", async () => {
    mockAnonymize.mockResolvedValue(undefined);
    await render(<CustomerDetailScreen id="c1" />);
    await fireEvent.press(screen.getByRole("button", { name: "Anonymiser ce locataire" }));
    expect(mockAnonymize).toHaveBeenCalledWith("c1");
  });

  it("ne propose pas l'anonymisation à un agent", async () => {
    mockRole = "AGENT";
    await render(<CustomerDetailScreen id="c1" />);
    expect(screen.queryByRole("button", { name: "Anonymiser ce locataire" })).toBeNull();
    expect(screen.getByRole("button", { name: "Afficher les numéros complets" })).toBeTruthy();
  });
});
