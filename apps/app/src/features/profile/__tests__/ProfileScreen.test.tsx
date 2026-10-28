import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import { renderWithClient as render } from "@/testing/render";
import { validatePasswordChange } from "../ChangePasswordForm";
import { ProfileScreen } from "../ProfileScreen";

const mockSignOut = jest.fn();
const mockApi = jest.fn();

jest.mock("@/lib/auth", () => ({
  useAuth: () => ({
    me: {
      user: { id: "u1", email: "alice@alpha.test", name: "Alice", role: "TENANT_ADMIN" },
      tenant: { id: "t1", slug: "alpha", name: "Alpha", address: null, phone: null, email: null, logoUrl: null, primaryColor: "#000000", secondaryColor: "#FFFFFF" },
    },
    signOut: mockSignOut,
  }),
}));
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  api: (...args: unknown[]) => mockApi(...args),
}));

beforeEach(() => {
  mockApi.mockReset();
  mockSignOut.mockReset();
});

async function fillPassword(current: string, next: string, confirm = next) {
  await fireEvent.changeText(screen.getByLabelText("Mot de passe actuel"), current);
  await fireEvent.changeText(screen.getByLabelText("Nouveau mot de passe"), next);
  await fireEvent.changeText(screen.getByLabelText("Confirmer le nouveau mot de passe"), confirm);
  await fireEvent.press(screen.getByRole("button", { name: "Changer le mot de passe" }));
}

describe("validatePasswordChange", () => {
  it("contrôle longueur, différence et confirmation", () => {
    expect(validatePasswordChange({ current: "", next: "court", confirm: "autre" })).toEqual({
      current: "Saisissez votre mot de passe actuel.",
      next: "Au moins 12 caractères.",
      confirm: "Les deux mots de passe ne correspondent pas.",
    });
    expect(validatePasswordChange({ current: "identique-123", next: "identique-123", confirm: "identique-123" }).next).toMatch(
      /différent/,
    );
    expect(validatePasswordChange({ current: "a", next: "nouveau-mdp-42", confirm: "nouveau-mdp-42" })).toEqual({});
  });
});

describe("ProfileScreen", () => {
  it("affiche le compte et la société", async () => {
    await render(<ProfileScreen />);
    expect(screen.getByText("alice@alpha.test")).toBeTruthy();
    expect(screen.getByText("Administrateur")).toBeTruthy();
    expect(screen.getByText("Ma société")).toBeTruthy();
  });

  it("n'appelle pas l'API si le formulaire est invalide", async () => {
    await render(<ProfileScreen />);
    await fillPassword("actuel", "court");
    expect(screen.getByText("Au moins 12 caractères.")).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("change le mot de passe", async () => {
    mockApi.mockResolvedValue(undefined);
    await render(<ProfileScreen />);
    await fillPassword("ancien-mot-de-passe", "nouveau-mot-de-passe-42");
    await waitFor(() => expect(screen.getByText(/Mot de passe modifié/)).toBeTruthy());
    expect(mockApi).toHaveBeenCalledWith("/me/password", {
      method: "POST",
      body: { currentPassword: "ancien-mot-de-passe", newPassword: "nouveau-mot-de-passe-42" },
    });
  });

  it("signale un mot de passe actuel incorrect", async () => {
    mockApi.mockRejectedValue(new ApiError(400, "Mot de passe actuel incorrect", "INVALID_PASSWORD"));
    await render(<ProfileScreen />);
    await fillPassword("faux", "nouveau-mot-de-passe-42");
    expect(await screen.findByText("Mot de passe actuel incorrect.")).toBeTruthy();
  });

  it("l'admin du client modifie son branding", async () => {
    mockApi.mockResolvedValue({});
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Modifier les informations" }));
    await fireEvent.changeText(screen.getByLabelText("Nom affiché"), "Alpha Logistique");
    await fireEvent.changeText(screen.getByLabelText("Couleur principale"), "#0f766e");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.getByText("Modifications enregistrées.")).toBeTruthy());
    expect(mockApi).toHaveBeenCalledWith("/tenant/branding", {
      method: "PUT",
      body: {
        name: "Alpha Logistique",
        address: null,
        phone: null,
        email: null,
        primaryColor: "#0F766E",
        secondaryColor: "#FFFFFF",
      },
    });
  });

  it("refuse une couleur invalide sans appeler l'API", async () => {
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Modifier les informations" }));
    await fireEvent.changeText(screen.getByLabelText("Couleur principale"), "rouge");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer" }));
    expect(screen.getByText("Format #RRGGBB, par exemple #1E3A8A.")).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("déconnecte", async () => {
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Se déconnecter" }));
    expect(mockSignOut).toHaveBeenCalled();
  });
});
