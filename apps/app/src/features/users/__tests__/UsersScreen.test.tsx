import { fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import type { TenantUser } from "@/lib/tenant-users";
import { UsersScreen } from "../UsersScreen";

const mockCreate = jest.fn();
const mockSetRole = jest.fn();
const mockReset = jest.fn();
const mockDisable = jest.fn();
const mockEnable = jest.fn();
const mockConfirm = jest.fn();
let mockRole = "TENANT_ADMIN";
let mockUsers: TenantUser[];

jest.mock("@/lib/tenant-users", () => ({
  ...jest.requireActual("@/lib/tenant-users"),
  useTenantUsers: () => ({ data: { users: mockUsers, limit: 20, currentUserId: "u1" }, isPending: false, error: null, refetch: jest.fn() }),
  useTenantUserActions: () => ({
    create: { mutateAsync: mockCreate, isPending: false },
    setRole: mockSetRole,
    resetPassword: mockReset,
    disable: mockDisable,
    enable: mockEnable,
  }),
}));
jest.mock("@/lib/auth", () => ({
  useAuth: () => ({ me: { user: { id: "u1", role: mockRole }, tenant: { slug: "alpha" } } }),
}));
jest.mock("@/lib/confirm", () => ({ confirmAction: (...args: unknown[]) => mockConfirm(...args) }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{`redirection ${href}`}</Text>;
  },
}));

const user = (overrides: Partial<TenantUser>): TenantUser => ({
  id: "u2",
  name: "Ali",
  email: "ali@alpha.test",
  role: "AGENT",
  mustChangePassword: false,
  disabledAt: null,
  createdAt: "2026-11-21T10:00:00Z",
  ...overrides,
});

beforeEach(() => {
  mockRole = "TENANT_ADMIN";
  mockUsers = [user({ id: "u1", name: "Alice", email: "alice@alpha.test", role: "TENANT_ADMIN" }), user({})];
  for (const m of [mockCreate, mockSetRole, mockReset, mockDisable, mockEnable, mockConfirm]) m.mockReset();
  mockConfirm.mockResolvedValue(true);
  mockSetRole.mockResolvedValue(undefined);
  mockDisable.mockResolvedValue(undefined);
});

describe("UsersScreen", () => {
  it("liste les comptes, le sien sans actions", async () => {
    await render(<UsersScreen />);
    expect(screen.getByText("2 comptes sur 20 possibles.")).toBeTruthy();
    expect(screen.getByText("Alice (vous)")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Alice, Administrateur" }));
    expect(screen.queryByRole("button", { name: "Désactiver" })).toBeNull();
  });

  it("crée un compte et affiche une seule fois son mot de passe provisoire", async () => {
    mockCreate.mockResolvedValue({ user: user({ id: "u3", email: "vic@alpha.test" }), temporaryPassword: "Abcdefgh23456789" });
    await render(<UsersScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter un compte" }));
    await fireEvent.changeText(screen.getByLabelText("Nom"), "Vic");
    await fireEvent.changeText(screen.getByLabelText("E-mail"), "vic@alpha.test");
    await fireEvent.press(screen.getByRole("radio", { name: "Consultation" }));
    await fireEvent.press(screen.getByRole("button", { name: "Créer le compte" }));
    expect(mockCreate).toHaveBeenCalledWith({ name: "Vic", email: "vic@alpha.test", role: "VIEWER" });
    expect(screen.getByText("Identifiants à transmettre à votre collaborateur")).toBeTruthy();
    expect(screen.getByText("Abcdefgh23456789")).toBeTruthy();
  });

  it("affiche le refus de l'API (adresse déjà utilisée)", async () => {
    mockCreate.mockRejectedValue(new ApiError(409, "Cette adresse e-mail a déjà un compte", "EMAIL_TAKEN"));
    await render(<UsersScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Ajouter un compte" }));
    await fireEvent.changeText(screen.getByLabelText("Nom"), "Bob");
    await fireEvent.changeText(screen.getByLabelText("E-mail"), "bob@bravo.test");
    await fireEvent.press(screen.getByRole("button", { name: "Créer le compte" }));
    expect(screen.getByText("Cette adresse e-mail a déjà un compte")).toBeTruthy();
  });

  it("change le rôle et désactive un compte après confirmation", async () => {
    await render(<UsersScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Ali, Agent" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Administrateur" }));
    expect(mockSetRole).toHaveBeenCalledWith("u2", "TENANT_ADMIN");
    await fireEvent.press(screen.getByRole("button", { name: "Désactiver" }));
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockDisable).toHaveBeenCalledWith("u2");
  });

  it("réactive un compte désactivé sans confirmation", async () => {
    mockUsers = [mockUsers[0]!, user({ disabledAt: "2026-11-21T11:00:00Z" })];
    mockEnable.mockResolvedValue(undefined);
    await render(<UsersScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Ali, Agent, désactivé" }));
    await fireEvent.press(screen.getByRole("button", { name: "Réactiver" }));
    expect(mockEnable).toHaveBeenCalledWith("u2");
  });

  it("renvoie vers le profil un compte qui n'est pas admin", async () => {
    mockRole = "AGENT";
    await render(<UsersScreen />);
    expect(screen.getByText("redirection /profile")).toBeTruthy();
  });
});
