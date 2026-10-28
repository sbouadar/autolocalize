import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { slugify } from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { renderWithClient as render } from "@/testing/render";
import { describeDetails } from "../AuditList";
import { NewTenantScreen, validateNewTenant } from "../NewTenantScreen";
import { TenantDetailScreen } from "../TenantDetailScreen";

const mockApi = jest.fn();
const mockConfirm = jest.fn();
const mockReplace = jest.fn();

jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  api: (...args: unknown[]) => mockApi(...args),
}));
jest.mock("@/lib/confirm", () => ({ confirmAction: (...args: unknown[]) => mockConfirm(...args) }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), push: jest.fn(), navigate: jest.fn() }),
}));

beforeEach(() => {
  mockApi.mockReset();
  mockConfirm.mockReset();
  mockReplace.mockReset();
});

describe("utilitaires du back-office", () => {
  it("slugify", () => {
    expect(slugify("Démo Transport & Fils")).toBe("demo-transport-fils");
    expect(slugify("  --Été 2026--  ")).toBe("ete-2026");
  });

  it("validateNewTenant", () => {
    const ok = { name: "A", slug: "a-b", address: "", phone: "", email: "", adminName: "B", adminEmail: "b@b.fr" };
    expect(validateNewTenant(ok)).toEqual({});
    expect(Object.keys(validateNewTenant({ ...ok, slug: "-a" }))).toEqual(["slug"]);
    expect(Object.keys(validateNewTenant({ ...ok, adminEmail: "x" }))).toEqual(["adminEmail"]);
  });

  it("describeDetails ne garde que les champs simples", () => {
    expect(describeDetails({ name: "A", plate: null, nested: { x: 1 } })).toBe("name : A · plate : —");
    expect(describeDetails(null)).toBe("");
  });
});

describe("NewTenantScreen", () => {
  async function fill() {
    await fireEvent.changeText(screen.getByLabelText("Nom"), "Bravo Transport");
    await fireEvent.changeText(screen.getByLabelText("Nom du titulaire"), "Bruno");
    await fireEvent.changeText(screen.getByLabelText("E-mail de connexion"), "bruno@bravo.test");
    await fireEvent.press(screen.getByRole("button", { name: "Créer le client" }));
  }

  it("crée le client et affiche une fois les identifiants provisoires", async () => {
    mockApi.mockResolvedValue({
      tenant: { id: "t2", slug: "bravo-transport", name: "Bravo Transport" },
      admin: { email: "bruno@bravo.test", temporaryPassword: "Abcdefgh23456789" },
    });
    await render(<NewTenantScreen />);
    await fill();
    expect(await screen.findByText("Abcdefgh23456789")).toBeTruthy();
    expect(screen.getByText("https://autolocalize.net/login/bravo-transport")).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith("/admin/tenants", expect.objectContaining({
      method: "POST",
      body: {
        slug: "bravo-transport",
        name: "Bravo Transport",
        address: null,
        phone: null,
        email: null,
        admin: { name: "Bruno", email: "bruno@bravo.test" },
      },
    }));
    await fireEvent.press(screen.getByRole("button", { name: /Ouvrir la fiche du client/ }));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/admin/tenants/[id]", params: { id: "t2" } });
  });

  it("affiche l'erreur de l'API (identifiant déjà pris)", async () => {
    mockApi.mockRejectedValue(new ApiError(409, "Cet identifiant de client est déjà utilisé"));
    await render(<NewTenantScreen />);
    await fill();
    expect(await screen.findByText("Cet identifiant de client est déjà utilisé")).toBeTruthy();
    expect(screen.queryByText(/Mot de passe provisoire/)).toBeNull();
  });
});

describe("TenantDetailScreen", () => {
  const detail = {
    tenant: {
      id: "t1",
      slug: "alpha",
      name: "Alpha",
      address: null,
      phone: null,
      email: null,
      logoUrl: null,
      primaryColor: "#1E3A8A",
      secondaryColor: "#F59E0B",
      status: "ACTIVE",
      traccarGroupId: 3,
    },
    users: [{ id: "u1", name: "Alice", email: "alice@alpha.test", role: "TENANT_ADMIN", mustChangePassword: false }],
    traccarAvailable: true,
    vehicles: [
      {
        id: "v1",
        name: "Camion 1",
        plate: null,
        traccarDeviceId: 1,
        device: { uniqueId: "865190074141964", traccarName: "GPS1", status: "online", lastUpdate: null, disabled: false },
      },
    ],
  };

  beforeEach(() => {
    mockApi.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === "/admin/tenants/t1" && !options?.method) return detail;
      if (path.startsWith("/admin/audit")) return { entries: [] };
      if (path.endsWith("/reset-password")) return { email: "alice@alpha.test", temporaryPassword: "Xyz23456789Abcde" };
      return {};
    });
  });

  it("affiche le client, ses traceurs et son compte", async () => {
    await render(<TenantDetailScreen id="t1" />);
    expect(await screen.findByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Camion 1")).toBeTruthy();
    expect(screen.getByText("alice@alpha.test")).toBeTruthy();
  });

  it("demande confirmation avant de suspendre, et n'agit pas si on annule", async () => {
    await render(<TenantDetailScreen id="t1" />);
    await screen.findByText("Alpha");
    mockConfirm.mockResolvedValueOnce(false);
    await fireEvent.press(screen.getByRole("radio", { name: "Suspendu" }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockApi).not.toHaveBeenCalledWith("/admin/tenants/t1", expect.objectContaining({ method: "PUT" }));

    mockConfirm.mockResolvedValueOnce(true);
    await fireEvent.press(screen.getByRole("radio", { name: "Suspendu" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith("/admin/tenants/t1", { method: "PUT", body: { status: "SUSPENDED" } }),
    );
  });

  it("réinitialise le mot de passe et affiche le nouveau mot de passe provisoire", async () => {
    mockConfirm.mockResolvedValue(true);
    await render(<TenantDetailScreen id="t1" />);
    await screen.findByText("Alpha");
    await fireEvent.press(screen.getByRole("button", { name: "Réinitialiser le mot de passe" }));
    expect(await screen.findByText("Xyz23456789Abcde")).toBeTruthy();
  });

  it("retire un traceur après confirmation", async () => {
    mockConfirm.mockResolvedValue(true);
    await render(<TenantDetailScreen id="t1" />);
    await screen.findByText("Alpha");
    await fireEvent.press(screen.getByRole("button", { name: "Retirer Camion 1" }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledWith("/admin/vehicles/v1", { method: "DELETE" }));
  });

  it("affecte un nouveau traceur par IMEI", async () => {
    await render(<TenantDetailScreen id="t1" />);
    await screen.findByText("Alpha");
    await fireEvent.press(screen.getByRole("button", { name: "Affecter un traceur" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Nouveau (IMEI)" }));
    await fireEvent.changeText(screen.getByLabelText("Nom du véhicule"), "Neuf");
    await fireEvent.changeText(screen.getByLabelText("IMEI du traceur"), "12");
    await fireEvent.press(screen.getByRole("button", { name: "Affecter le traceur" }));
    expect(screen.getByText(/IMEI invalide/)).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("IMEI du traceur"), "865190074149999");
    await fireEvent.press(screen.getByRole("button", { name: "Affecter le traceur" }));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith("/admin/tenants/t1/vehicles", {
        method: "POST",
        body: { name: "Neuf", plate: null, imei: "865190074149999" },
      }),
    );
  });
});
