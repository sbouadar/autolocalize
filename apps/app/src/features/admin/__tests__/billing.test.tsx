import { fireEvent, render, screen } from "@testing-library/react-native";
import { adminTenantSchema, type Billing } from "@/lib/admin";
import { BillingCard } from "../BillingCard";
import { BillingScreen } from "../BillingScreen";

const mockPush = jest.fn();
let mockBilling: Billing;

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>{`redirection ${href}`}</Text>;
  },
}));
let mockRole = "SUPER_ADMIN";
jest.mock("@/lib/auth", () => ({ useAuth: () => ({ me: { user: { role: mockRole } } }) }));
jest.mock("@/lib/admin", () => ({
  ...jest.requireActual("@/lib/admin"),
  useBilling: () => ({ data: mockBilling, isPending: false, error: null, refetch: jest.fn() }),
}));

const tenant = adminTenantSchema.parse({
  id: "t1",
  slug: "alpha",
  name: "Alpha",
  address: null,
  phone: null,
  email: null,
  logoUrl: null,
  primaryColor: "#141414",
  secondaryColor: "#F59E0B",
  status: "ACTIVE",
  traccarGroupId: null,
  plan: "Pro",
  vehicleQuota: 5,
  monthlyFee: "450.5",
  paidUntil: "2026-12-31T00:00:00.000Z",
  billingNotes: null,
});

beforeEach(() => {
  mockPush.mockReset();
  mockRole = "SUPER_ADMIN";
  mockBilling = {
    today: "2026-11-22",
    tenants: [
      { id: "t2", name: "Bravo", slug: "bravo", status: "ACTIVE", currency: "MAD", plan: null, vehicleQuota: 1, monthlyFee: "200.00", paidUntil: "2026-11-19", billingNotes: null, billingStatus: "OVERDUE", daysLeft: -3, vehicleCount: 2, overQuota: true },
      { id: "t1", name: "Alpha", slug: "alpha", status: "ACTIVE", currency: "MAD", plan: "Pro", vehicleQuota: 5, monthlyFee: "450.50", paidUntil: "2026-12-31", billingNotes: null, billingStatus: "OK", daysLeft: 39, vehicleCount: 3, overQuota: false },
    ],
    monthlyRevenue: [{ currency: "MAD", amount: "650.50" }],
    counts: { overdue: 1, dueSoon: 0, overQuota: 1 },
  };
});

describe("BillingCard", () => {
  it("préremplit l'abonnement et enregistre les changements", async () => {
    const onUpdate = jest.fn().mockResolvedValue(undefined);
    await render(<BillingCard tenant={tenant} onUpdate={onUpdate} />);
    expect(screen.getByLabelText("Montant mensuel (MAD)").props.value).toBe("450,5");
    expect(screen.getByRole("button", { name: "Payé jusqu’au" }).props.accessibilityValue).toEqual({ text: "31/12/2026" });
    await fireEvent.changeText(screen.getByLabelText("Véhicules prévus"), "8");
    await fireEvent.changeText(screen.getByLabelText("Notes (mode de paiement, relances…)"), " Virement ");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer la facturation" }));
    expect(onUpdate).toHaveBeenCalledWith({ plan: "Pro", vehicleQuota: 8, monthlyFee: 450.5, paidUntil: "2026-12-31", billingNotes: "Virement" });
  });

  it("refuse un quota ou un montant illisible", async () => {
    const onUpdate = jest.fn();
    await render(<BillingCard tenant={tenant} onUpdate={onUpdate} />);
    await fireEvent.changeText(screen.getByLabelText("Véhicules prévus"), "cinq");
    await fireEvent.press(screen.getByRole("button", { name: "Enregistrer la facturation" }));
    expect(screen.getByText("Saisissez le quota en nombre de véhicules.")).toBeTruthy();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("BillingScreen", () => {
  it("met en avant les échéances dépassées et les quotas dépassés", async () => {
    await render(<BillingScreen />);
    expect(screen.getByLabelText("Échéances dépassées : 1")).toBeTruthy();
    expect(screen.getByLabelText("Revenu mensuel (MAD) : 650,5 DH, clients actifs")).toBeTruthy();
    expect(screen.getByText("Payé jusqu’au 19/11/2026 : dépassé de 3 jours")).toBeTruthy();
    expect(screen.getByText("200 DH/mois · 2 / 1 véhicules (quota dépassé)")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Bravo, Échéance dépassée. Ouvrir la fiche" }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/admin/tenants/[id]", params: { id: "t2" } });
  });

  it("est réservé au super-admin", async () => {
    mockRole = "TENANT_ADMIN";
    await render(<BillingScreen />);
    expect(screen.getByText("redirection /")).toBeTruthy();
  });
});
