import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import { LoginScreen } from "../LoginScreen";

// Préfixe « mock » obligatoire : Jest refuse que ses fabriques référencent d'autres variables.
const mockSignIn = jest.fn();
const mockReplace = jest.fn();
let mockPublicBranding: { data: unknown; isPending: boolean } = { data: null, isPending: false };

jest.mock("@/lib/auth", () => ({
  useAuth: () => ({ me: null, loading: false, error: null, signIn: mockSignIn, signOut: jest.fn() }),
}));
jest.mock("../public-branding", () => ({ usePublicBranding: () => mockPublicBranding }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  Redirect: () => null,
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

beforeEach(() => {
  mockSignIn.mockReset();
  mockReplace.mockReset();
  mockPublicBranding = { data: null, isPending: false };
});

// RNTL 14 : render et fireEvent sont asynchrones.
async function fill(email: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText("Adresse e-mail"), email);
  await fireEvent.changeText(screen.getByLabelText("Mot de passe"), password);
  await fireEvent.press(screen.getByRole("button", { name: "Se connecter" }));
}

describe("LoginScreen", () => {
  it("affiche le branding AutoLocalize par défaut", async () => {
    await render(<LoginScreen slug={null} />);
    expect(await screen.findByText("AutoLocalize")).toBeTruthy();
    expect(screen.queryByText(/Propulsé par/)).toBeNull();
  });

  it("affiche le nom du client et la mention de la plateforme", async () => {
    mockPublicBranding = {
      data: { name: "Démo Transport", logoUrl: null, primaryColor: "#1E3A8A", secondaryColor: "#F59E0B" },
      isPending: false,
    };
    await render(<LoginScreen slug="demo" />);
    expect(await screen.findByText("Démo Transport")).toBeTruthy();
    expect(screen.getByText("Propulsé par AutoLocalize")).toBeTruthy();
  });

  it("valide le formulaire sans appeler le serveur", async () => {
    await render(<LoginScreen slug={null} />);
    await fill("pas-un-email", "");
    expect(await screen.findByText("Saisissez une adresse e-mail valide.")).toBeTruthy();
    expect(screen.getByText("Saisissez votre mot de passe.")).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("affiche un message clair si les identifiants sont faux", async () => {
    mockSignIn.mockRejectedValue(new ApiError(401, "Invalid email or password"));
    await render(<LoginScreen slug={null} />);
    await fill("demo@autolocalize.net", "mauvais-mot-de-passe");
    expect(await screen.findByText("E-mail ou mot de passe incorrect.")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirige vers l'accueil après connexion", async () => {
    mockSignIn.mockResolvedValue(undefined);
    await render(<LoginScreen slug={null} />);
    await fill(" demo@autolocalize.net ", "bon-mot-de-passe");
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
    expect(mockSignIn).toHaveBeenCalledWith("demo@autolocalize.net", "bon-mot-de-passe");
  });
});
