// Comptes du client, gérés par son admin : /tenant/users (voir apps/api/src/routes/tenant-users.ts).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";

export const tenantRoleSchema = z.enum(["TENANT_ADMIN", "AGENT", "VIEWER"]);
export type TenantRole = z.infer<typeof tenantRoleSchema>;

export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  TENANT_ADMIN: "Administrateur",
  AGENT: "Agent",
  VIEWER: "Consultation",
};

export const TENANT_ROLE_HINTS: Record<TenantRole, string> = {
  TENANT_ADMIN: "Tous les droits : comptes, société, zones, coupure moteur.",
  AGENT: "Opérations courantes : relevés de compteur, et bientôt réservations, départs et retours.",
  VIEWER: "Consultation seulement : carte, historique, alertes.",
};

const tenantUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: tenantRoleSchema.catch("VIEWER"),
  mustChangePassword: z.boolean(),
  disabledAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TenantUser = z.infer<typeof tenantUserSchema>;

const usersSchema = z.object({ users: z.array(tenantUserSchema), limit: z.number(), currentUserId: z.string() });
const credentialsSchema = z.object({ email: z.string(), temporaryPassword: z.string() });
const createdSchema = z.object({ user: tenantUserSchema, temporaryPassword: z.string() });

const USERS_KEY = ["tenant", "users"] as const;

export function useTenantUsers() {
  return useQuery({ queryKey: USERS_KEY, queryFn: () => api("/tenant/users", { schema: usersSchema }) });
}

/** Actions sur les comptes ; les mots de passe provisoires restent dans l'état de l'écran, jamais en cache. */
export function useTenantUserActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: USERS_KEY });
  const path = (id: string) => `/tenant/users/${encodeURIComponent(id)}`;
  return {
    create: useMutation({
      mutationFn: (body: { name: string; email: string; role: TenantRole }) =>
        api("/tenant/users", { method: "POST", body, schema: createdSchema }),
      onSuccess: refresh,
    }),
    setRole: (id: string, role: TenantRole) => api(path(id), { method: "PUT", body: { role } }).then(refresh),
    resetPassword: (id: string) =>
      api(`${path(id)}/reset-password`, { method: "POST", body: {}, schema: credentialsSchema }).finally(refresh),
    disable: (id: string) => api(`${path(id)}/disable`, { method: "POST", body: {} }).then(refresh),
    enable: (id: string) => api(`${path(id)}/enable`, { method: "POST", body: {} }).then(refresh),
  };
}
