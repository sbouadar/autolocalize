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
const mockPickup = jest.fn();
const mockGiveBack = jest.fn();
const mockUpload = jest.fn();
const mockRemovePhoto = jest.fn();
let mockPhotos: { id: string; phase: "PICKUP" | "RETURN"; caption: string | null; createdAt: string }[] = [];
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
jest.mock("@/lib/zones", () => ({ useZones: () => ({ data: { zones: [{ id: "z1", name: "Maroc" }] } }) }));
// Sélecteur de photo et image privée : remplacés par des éléments simples (pas d'appareil photo en test).
jest.mock("@/components/PhotoPicker", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    PhotoPicker: ({ onPick }: { onPick: (d: string) => void }) => (
      <Pressable accessibilityRole="button" onPress={() => onPick("data:image/jpeg;base64,AAAA")}>
        <Text>Ajouter une photo</Text>
      </Pressable>
    ),
  };
});
jest.mock("@/components/PrivateImage", () => {
  const { Text } = jest.requireActual("react-native");
  return { PrivateImage: ({ path }: { path: string }) => <Text>{`image ${path}`}</Text> };
});
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
    pickup: { mutateAsync: mockPickup, isPending: false },
    giveBack: { mutateAsync: mockGiveBack, isPending: false },
  }),
  useRentalPhotos: () => ({ data: { photos: mockPhotos, limitPerPhase: 30 } }),
  useRentalPhotoActions: () => ({ upload: { mutateAsync: mockUpload, isPending: false }, remove: mockRemovePhoto }),
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
  for (const m of [mockPush, mockReplace, mockConfirm, mockCreateRental, mockCancel, mockReveal, mockAnonymize, mockPickup, mockGiveBack, mockUpload, mockRemovePhoto]) m.mockReset();
  mockPhotos = [];
  mockPickup.mockResolvedValue({});
  mockGiveBack.mockResolvedValue({});
  mockUpload.mockResolvedValue({});
  mockRemovePhoto.mockResolvedValue(undefined);
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

describe("Départ, retour et photos", () => {
  it("enregistre le départ avec le compteur et le carburant", async () => {
    await render(<RentalDetailScreen id="r1" />);
    await fireEvent.press(screen.getByRole("button", { name: "Départ du véhicule" }));
    await fireEvent.press(screen.getByRole("button", { name: "Valider le départ" }));
    expect(screen.getByText(/en chiffres/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Compteur au départ (km)"), "45 000");
    await fireEvent.press(screen.getByRole("button", { name: "Valider le départ" }));
    expect(screen.getByText("Indiquez le niveau de carburant.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "3/4" }));
    await fireEvent.press(screen.getByRole("button", { name: "Valider le départ" }));
    expect(mockPickup).toHaveBeenCalledWith({ id: "r1", body: { odometerKm: 45_000, fuelLevel: 6 } });
  });

  it("refuse un compteur de retour inférieur à celui du départ", async () => {
    mockRentals = [rental({ id: "r2", status: "ONGOING", pickedUpAt: "2026-12-01T09:05:00Z", odometerOutKm: 45_000, fuelOut: 6 })];
    await render(<RentalDetailScreen id="r2" />);
    await fireEvent.press(screen.getByRole("button", { name: "Retour du véhicule" }));
    await fireEvent.changeText(screen.getByLabelText("Compteur au retour (km)"), "44000");
    await fireEvent.press(screen.getByRole("radio", { name: "1/2" }));
    await fireEvent.press(screen.getByRole("button", { name: "Valider le retour" }));
    expect(mockGiveBack).not.toHaveBeenCalled();
    expect(screen.getByText(/au départ\.$/)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("Compteur au retour (km)"), "45320");
    await fireEvent.press(screen.getByRole("button", { name: "Valider le retour" }));
    expect(mockGiveBack).toHaveBeenCalledWith({ id: "r2", body: { odometerKm: 45_320, fuelLevel: 4 } });
  });

  it("ajoute une photo au départ ; seule l'admin peut en supprimer", async () => {
    mockPhotos = [{ id: "p1", phase: "PICKUP", caption: null, createdAt: "2026-12-01T09:00:00Z" }];
    await render(<RentalDetailScreen id="r1" />);
    expect(screen.getByText("Photos au départ (1)")).toBeTruthy();
    expect(screen.getByText("image /rentals/r1/photos/p1")).toBeTruthy();
    await fireEvent.press(screen.getByText("Ajouter une photo"));
    expect(mockUpload).toHaveBeenCalledWith({ phase: "PICKUP", data: "data:image/jpeg;base64,AAAA" });
    await fireEvent.press(screen.getByRole("button", { name: "Supprimer la photo 1" }));
    expect(mockRemovePhoto).toHaveBeenCalledWith("p1");
  });

  it("ne propose à l'agent ni de supprimer une photo, ni au compte en consultation d'en ajouter", async () => {
    mockPhotos = [{ id: "p1", phase: "PICKUP", caption: null, createdAt: "2026-12-01T09:00:00Z" }];
    mockRole = "AGENT";
    const view = await render(<RentalDetailScreen id="r1" />);
    expect(screen.queryByRole("button", { name: "Supprimer la photo 1" })).toBeNull();
    expect(screen.getByText("Ajouter une photo")).toBeTruthy();
    await view.unmount();
    mockRole = "VIEWER";
    await render(<RentalDetailScreen id="r1" />);
    expect(screen.queryByText("Ajouter une photo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Départ du véhicule" })).toBeNull();
  });

  it("montre les compteurs, le carburant et la distance d'une location terminée", async () => {
    mockRentals = [
      rental({ id: "r3", status: "COMPLETED", pickedUpAt: "2026-12-01T09:05:00Z", returnedAt: "2026-12-03T08:50:00Z", odometerOutKm: 45_000, odometerInKm: 45_320, fuelOut: 6, fuelIn: 4, gpsDistanceKm: 310.4, allowedZoneId: "z1" }),
    ];
    await render(<RentalDetailScreen id="r3" />);
    expect(screen.getByText(/^320\skm au compteur, 310\skm mesurés par GPS$/)).toBeTruthy();
    expect(screen.getByText("3/4")).toBeTruthy();
    expect(screen.getByText("Maroc")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retour du véhicule" })).toBeNull();
    expect(screen.getByText("Photos au retour (0)")).toBeTruthy();
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
