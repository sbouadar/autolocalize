import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import { confirmationMessage } from "@/lib/commands";
import type { Vehicle } from "@/lib/types";
import { renderWithClient as render } from "@/testing/render";
import { EngineCard } from "../EngineCard";

const mockApi = jest.fn();
const mockConfirm = jest.fn();

jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  api: (...args: unknown[]) => mockApi(...args),
}));
jest.mock("@/lib/confirm", () => ({ confirmAction: (...args: unknown[]) => mockConfirm(...args) }));

const vehicle: Vehicle = {
  id: "v1",
  name: "Camion",
  plate: null,
  status: "online",
  disabled: false,
  lastUpdate: null,
  position: {
    latitude: 33,
    longitude: -7,
    speedKmh: 42,
    course: 0,
    fixTime: "2026-10-29T08:00:00Z",
    address: null,
    ignition: true,
    motion: true,
  },
};

let state: { canSend: boolean; supported: unknown; history: unknown[] };

beforeEach(() => {
  mockApi.mockReset();
  mockConfirm.mockReset();
  state = { canSend: true, supported: { ENGINE_STOP: true, ENGINE_RESUME: true }, history: [] };
  mockApi.mockImplementation(async (_path: string, options?: { method?: string }) =>
    options?.method === "POST" ? { status: "SENT", queued: false } : state,
  );
});

describe("confirmationMessage", () => {
  it("rappelle la vitesse avant une coupure", () => {
    expect(confirmationMessage("ENGINE_STOP", 42.4, true)).toMatch(/^Le véhicule roule actuellement à 42 km\/h\./);
    expect(confirmationMessage("ENGINE_STOP", 0, false)).toMatch(/^Le véhicule semble à l’arrêt\./);
    expect(confirmationMessage("ENGINE_STOP", null, false)).toMatch(/^Vitesse actuelle inconnue\./);
  });
});

describe("EngineCard", () => {
  it("demande confirmation avec la vitesse et n'envoie rien si on annule", async () => {
    mockConfirm.mockResolvedValue(false);
    await render(<EngineCard vehicle={vehicle} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Couper le moteur" }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockConfirm.mock.calls[0][1]).toMatch(/roule actuellement à 42 km\/h/);
    expect(mockApi).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "POST" }));
  });

  it("coupe le moteur après confirmation", async () => {
    mockConfirm.mockResolvedValue(true);
    await render(<EngineCard vehicle={vehicle} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Couper le moteur" }));
    expect(await screen.findByText("Coupure du moteur : commande transmise au traceur.")).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith("/vehicles/v1/commands", expect.objectContaining({ method: "POST", body: { command: "ENGINE_STOP" } }));
  });

  it("signale une commande mise en attente (traceur hors ligne)", async () => {
    mockConfirm.mockResolvedValue(true);
    mockApi.mockImplementation(async (_p: string, o?: { method?: string }) => (o?.method === "POST" ? { status: "SENT", queued: true } : state));
    await render(<EngineCard vehicle={vehicle} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Rétablir le moteur" }));
    expect(await screen.findByText(/transmise à sa prochaine connexion/)).toBeTruthy();
  });

  it("explique le refus pour cause de fréquence", async () => {
    mockConfirm.mockResolvedValue(true);
    mockApi.mockImplementation(async (_p: string, o?: { method?: string }) => {
      if (o?.method === "POST") throw new ApiError(429, "Trop de requêtes");
      return state;
    });
    await render(<EngineCard vehicle={vehicle} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Couper le moteur" }));
    expect(await screen.findByText("Une commande vient d’être envoyée : patientez une minute.")).toBeTruthy();
  });

  it("n'affiche pas les boutons en lecture seule, ni si le traceur ne gère pas la coupure", async () => {
    state = { canSend: false, supported: { ENGINE_STOP: true, ENGINE_RESUME: true }, history: [] };
    await render(<EngineCard vehicle={vehicle} />);
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Couper le moteur" })).toBeNull();

    state = { canSend: true, supported: { ENGINE_STOP: false, ENGINE_RESUME: false }, history: [] };
    await render(<EngineCard vehicle={vehicle} />);
    expect(await screen.findByText(/ne prend pas en charge la coupure/)).toBeTruthy();
  });
});
