import { fireEvent, render, screen } from "@testing-library/react-native";
import { Share } from "react-native";
import { ApiError } from "@/lib/api";
import type { ShareLink, SharedPosition } from "@/lib/share-links";
import { ShareCard } from "../../vehicle/ShareCard";
import { SharedPositionScreen } from "../SharedPositionScreen";

const mockCreate = jest.fn();
const mockRevoke = jest.fn();
let mockLinks: ShareLink[] = [];
let mockShared: { data?: SharedPosition; error?: unknown };
let mockMapVehicles: { name: string; position: { latitude: number } }[] = [];

jest.mock("@/lib/confirm", () => ({ confirmAction: async () => true }));
jest.mock("@/lib/share-links", () => ({
  ...jest.requireActual("@/lib/share-links"),
  useShareLinks: () => ({ data: { links: mockLinks } }),
  useShareLinkActions: () => ({ create: { mutateAsync: mockCreate, isPending: false }, revoke: mockRevoke }),
  useSharedPosition: () => ({ ...mockShared, isPending: false, refetch: jest.fn() }),
}));
jest.mock("../../map/VehicleMap", () => ({
  VehicleMap: ({ vehicles }: { vehicles: typeof mockMapVehicles }) => {
    mockMapVehicles = vehicles;
    return null;
  },
}));

beforeEach(() => {
  mockLinks = [];
  mockCreate.mockReset().mockResolvedValue({ link: {}, token: "t".repeat(43), path: `/share/${"t".repeat(43)}` });
  mockRevoke.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction", activityType: undefined });
});

describe("ShareCard", () => {
  it("crée un lien pour la durée choisie et l'envoie par le menu de partage", async () => {
    await render(<ShareCard vehicleId="v1" />);
    await fireEvent.press(screen.getByRole("button", { name: "Créer un lien" }));
    await fireEvent.press(screen.getByRole("radio", { name: "3 jours" }));
    await fireEvent.changeText(screen.getByLabelText("Pour qui ? (facultatif)"), " Client ");
    await fireEvent.press(screen.getByRole("button", { name: "Créer et partager" }));
    expect(mockCreate).toHaveBeenCalledWith({ durationHours: 72, label: "Client" });
    const url = `https://autolocalize.net/share/${"t".repeat(43)}`;
    expect(Share.share).toHaveBeenCalledWith({ message: url });
    expect(screen.getByText(url)).toBeTruthy();
  });

  it("liste les liens actifs et les désactive", async () => {
    mockLinks = [
      { id: "s1", label: "Dépanneuse", expiresAt: "2026-11-23T10:00:00Z", revokedAt: null, createdAt: "2026-11-22T10:00:00Z", active: true },
      { id: "s2", label: "Ancien", expiresAt: "2026-11-20T10:00:00Z", revokedAt: null, createdAt: "2026-11-19T10:00:00Z", active: false },
    ];
    await render(<ShareCard vehicleId="v1" />);
    expect(screen.queryByText("Ancien")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Désactiver le lien Dépanneuse" }));
    expect(mockRevoke).toHaveBeenCalledWith("s1");
  });
});

describe("SharedPositionScreen", () => {
  it("montre le véhicule sur la carte avec l'heure de sa position", async () => {
    mockShared = {
      data: {
        vehicleName: "Clio",
        online: true,
        position: { latitude: 33.57, longitude: -7.59, speedKmh: 50, course: 90, fixTime: "2026-11-22T10:00:00Z" },
        expiresAt: "2026-11-23T10:00:00Z",
      },
    };
    await render(<SharedPositionScreen token="abc" />);
    expect(screen.getByText("Clio")).toBeTruthy();
    expect(mockMapVehicles.map((v) => [v.name, v.position.latitude])).toEqual([["Clio", 33.57]]);
    expect(screen.getByText(/50 km\/h/)).toBeTruthy();
  });

  it("annonce un lien expiré", async () => {
    mockShared = { error: new ApiError(404, "Introuvable") };
    await render(<SharedPositionScreen token="abc" />);
    expect(screen.getByText("Lien expiré")).toBeTruthy();
  });
});
