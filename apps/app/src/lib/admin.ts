// Back-office (super-admin) : contrats des routes /admin/* de l'API et hooks associés.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";
import { deviceStatusSchema } from "./types";

const nullableString = z.string().nullable();

export const tenantStatusSchema = z.enum(["ACTIVE", "SUSPENDED", "CANCELLED"]);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const TENANT_STATUS_LABELS: Record<TenantStatus, string> = {
  ACTIVE: "Actif",
  SUSPENDED: "Suspendu",
  CANCELLED: "Résilié",
};

const tenantSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: tenantStatusSchema,
  logoUrl: nullableString,
  primaryColor: z.string(),
  createdAt: z.string(),
  vehicleCount: z.number(),
  userCount: z.number(),
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;

export const adminTenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  address: nullableString,
  phone: nullableString,
  email: nullableString,
  logoUrl: nullableString,
  primaryColor: z.string(),
  secondaryColor: z.string(),
  status: tenantStatusSchema,
  traccarGroupId: z.number().nullable(),
});
export type AdminTenant = z.infer<typeof adminTenantSchema>;

const tenantDetailSchema = z.object({
  tenant: adminTenantSchema,
  users: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.string(),
      mustChangePassword: z.boolean(),
    }),
  ),
  traccarAvailable: z.boolean(),
  vehicles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      plate: nullableString,
      traccarDeviceId: z.number(),
      device: z
        .object({
          uniqueId: z.string(),
          traccarName: z.string(),
          status: deviceStatusSchema,
          lastUpdate: nullableString,
          disabled: z.boolean(),
        })
        .nullable(),
    }),
  ),
});
export type TenantDetail = z.infer<typeof tenantDetailSchema>;

const deviceSchema = z.object({
  id: z.number(),
  name: z.string(),
  uniqueId: z.string(),
  status: deviceStatusSchema,
  lastUpdate: nullableString,
  disabled: z.boolean(),
  assignment: z
    .object({ vehicleId: z.string(), vehicleName: z.string(), tenantId: z.string(), tenantName: z.string() })
    .nullable(),
});
export type AdminDevice = z.infer<typeof deviceSchema>;

const credentialsSchema = z.object({ email: z.string(), temporaryPassword: z.string() });
export type Credentials = z.infer<typeof credentialsSchema>;

const createTenantResponseSchema = z.object({
  tenant: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  admin: credentialsSchema,
});

const auditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  tenantId: nullableString,
  targetId: nullableString,
  details: z.unknown(),
  createdAt: z.string(),
  actorEmail: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const AUDIT_LABELS: Record<string, string> = {
  "tenant.create": "Création du client",
  "tenant.update": "Modification du client",
  "tenant.logo.set": "Nouveau logo",
  "tenant.logo.remove": "Logo supprimé",
  "tenant.password.reset": "Mot de passe réinitialisé",
  "vehicle.assign": "Traceur affecté",
  "vehicle.update": "Véhicule modifié",
  "vehicle.unassign": "Traceur retiré",
  "branding.update": "Branding modifié par le client",
};

const ADMIN_KEY = ["admin"] as const;
const tenantKey = (id: string) => [...ADMIN_KEY, "tenant", id] as const;

export function useTenants() {
  return useQuery({
    queryKey: [...ADMIN_KEY, "tenants"],
    queryFn: () => api("/admin/tenants", { schema: z.object({ tenants: z.array(tenantSummarySchema) }) }),
  });
}

export function useTenantDetail(id: string) {
  return useQuery({
    queryKey: tenantKey(id),
    queryFn: () => api(`/admin/tenants/${encodeURIComponent(id)}`, { schema: tenantDetailSchema }),
  });
}

export function useDevices(enabled: boolean) {
  return useQuery({
    queryKey: [...ADMIN_KEY, "devices"],
    queryFn: () => api("/admin/devices", { schema: z.object({ devices: z.array(deviceSchema) }) }),
    enabled,
  });
}

export function useAudit(tenantId?: string) {
  return useQuery({
    queryKey: [...ADMIN_KEY, "audit", tenantId ?? "all"],
    queryFn: () =>
      api(`/admin/audit${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ""}`, {
        schema: z.object({ entries: z.array(auditEntrySchema) }),
      }),
  });
}

export interface NewTenantInput {
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  admin: { name: string; email: string };
}

/** Le mot de passe provisoire n'est renvoyé qu'ici : il reste dans l'état de l'écran, jamais en cache. */
export function useCreateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewTenantInput) =>
      api("/admin/tenants", { method: "POST", body: input, schema: createTenantResponseSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_KEY }),
  });
}

/** Actions sur un client existant ; chacune rafraîchit la fiche, la liste et le journal. */
export function useTenantActions(id: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
  const base = `/admin/tenants/${encodeURIComponent(id)}`;
  return {
    update: (body: Record<string, unknown>) => api(base, { method: "PUT", body }).then(refresh),
    setLogo: (data: string) => api(`${base}/logo`, { method: "POST", body: { data } }).then(refresh),
    removeLogo: () => api(`${base}/logo`, { method: "DELETE" }).then(refresh),
    resetPassword: () => api(`${base}/reset-password`, { method: "POST", body: {}, schema: credentialsSchema }).finally(refresh),
    assignVehicle: (body: AssignVehicleInput) =>
      api(`${base}/vehicles`, { method: "POST", body }).then(refresh),
    updateVehicle: (vehicleId: string, body: { name?: string; plate?: string | null }) =>
      api(`/admin/vehicles/${encodeURIComponent(vehicleId)}`, { method: "PUT", body }).then(refresh),
    removeVehicle: (vehicleId: string) =>
      api(`/admin/vehicles/${encodeURIComponent(vehicleId)}`, { method: "DELETE" }).then(refresh),
  };
}

export interface AssignVehicleInput {
  name: string;
  plate: string | null;
  traccarDeviceId?: number;
  imei?: string;
}

/** Identifiant d'URL proposé à partir du nom : « Démo Transport » → « demo-transport ». */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
