import { fireEvent, render, screen } from "@testing-library/react-native";
import { base64Bytes, LogoPicker } from "../LogoPicker";

const mockLaunch = jest.fn();
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: (...args: unknown[]) => mockLaunch(...args) }));

const asset = (mimeType: string, base64: string | null) => ({ canceled: false, assets: [{ mimeType, base64 }] });

beforeEach(() => mockLaunch.mockReset());

describe("LogoPicker (mobile)", () => {
  it("envoie l'image choisie telle quelle, en data URL", async () => {
    const onPick = jest.fn();
    mockLaunch.mockResolvedValue(asset("image/png", "iVBORw0KGgo="));
    await render(<LogoPicker onPick={onPick} />);
    await fireEvent.press(screen.getByRole("button", { name: "Choisir un logo…" }));
    expect(mockLaunch).toHaveBeenCalledWith({ mediaTypes: ["images"], base64: true, exif: false });
    expect(onPick).toHaveBeenCalledWith("data:image/png;base64,iVBORw0KGgo=");
  });

  it("refuse un format non pris en charge ou une image trop lourde", async () => {
    const onPick = jest.fn();
    mockLaunch.mockResolvedValueOnce(asset("image/heic", "AAAA"));
    await render(<LogoPicker onPick={onPick} />);
    await fireEvent.press(screen.getByRole("button", { name: "Choisir un logo…" }));
    expect(screen.getByText("Format non pris en charge : PNG, JPEG ou WebP.")).toBeTruthy();
    mockLaunch.mockResolvedValueOnce(asset("image/jpeg", "A".repeat(700_000)));
    await fireEvent.press(screen.getByRole("button", { name: "Choisir un logo…" }));
    expect(screen.getByText("Logo trop lourd : 512 Ko au maximum.")).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("ne fait rien si le choix est annulé", async () => {
    const onPick = jest.fn();
    mockLaunch.mockResolvedValue({ canceled: true, assets: null });
    await render(<LogoPicker onPick={onPick} />);
    await fireEvent.press(screen.getByRole("button", { name: "Choisir un logo…" }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("calcule la taille réelle d'un contenu base64", () => {
    expect(base64Bytes("AAAA")).toBe(3);
    expect(base64Bytes("AAA=")).toBe(2);
    expect(base64Bytes("AA==")).toBe(1);
  });
});
