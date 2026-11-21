// Module location : locataires (/customers) et réservations (/rentals). Voir apps/api/src/routes.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";
import { currencySchema, type Currency } from "./types";

const nullableString = z.string().nullable();

export const idDocumentTypeSchema = z.enum(["NATIONAL_ID", "PASSPORT", "RESIDENCE_PERMIT", "OTHER"]);
export type IdDocumentType = z.infer<typeof idDocumentTypeSchema>;
export const ID_DOCUMENT_LABELS: Record<IdDocumentType, string> = {
  NATIONAL_ID: "Carte d’identité",
  PASSPORT: "Passeport",
  RESIDENCE_PERMIT: "Titre de séjour",
  OTHER: "Autre",
};

export const customerSchema = z.object({
  id: z.string(),
  kind: z.enum(["PERSON", "COMPANY"]).catch("PERSON"),
  name: z.string(),
  phone: nullableString,
  email: nullableString,
  address: nullableString,
  birthDate: nullableString,
  idDocumentType: idDocumentTypeSchema.nullable().catch(null),
  /** « ••••1234 » : le numéro complet ne s'obtient que par useRevealIdentity. */
  idDocumentMasked: nullableString,
  licenseMasked: nullableString,
  licenseExpiresOn: nullableString,
  anonymized: z.boolean(),
  notes: nullableString,
});
export type Customer = z.infer<typeof customerSchema>;

export interface CustomerInput {
  kind?: "PERSON" | "COMPANY";
  name?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  birthDate?: string | null;
  idDocumentType?: IdDocumentType | null;
  /** Absent : numéro inchangé ; chaîne vide : effacé. */
  idDocumentNumber?: string | null;
  licenseNumber?: string | null;
  licenseExpiresOn?: string | null;
  notes?: string | null;
}

const CUSTOMERS_KEY = ["customers"] as const;
const customerResponse = z.object({ customer: customerSchema });

export function useCustomers(query: string) {
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, "list", query],
    queryFn: () =>
      api(`/customers${query ? `?q=${encodeURIComponent(query)}` : ""}`, { schema: z.object({ customers: z.array(customerSchema) }) }),
    staleTime: 30_000,
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: [...CUSTOMERS_KEY, id],
    queryFn: () => api(`/customers/${encodeURIComponent(id)}`, { schema: customerResponse }),
  });
}

export function useCustomerActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: CUSTOMERS_KEY });
  const path = (id: string) => `/customers/${encodeURIComponent(id)}`;
  return {
    create: useMutation({
      mutationFn: (body: CustomerInput) => api("/customers", { method: "POST", body, schema: customerResponse }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: CustomerInput }) => api(path(id), { method: "PUT", body, schema: customerResponse }),
      onSuccess: refresh,
    }),
    /** Numéros complets : jamais mis en cache, chaque consultation est journalisée par l'API. */
    revealIdentity: (id: string) =>
      api(`${path(id)}/identity`, {
        schema: z.object({ idDocumentNumber: nullableString, licenseNumber: nullableString }),
      }),
    anonymize: (id: string) => api(`${path(id)}/anonymize`, { method: "POST", body: {} }).then(refresh),
  };
}

export const rentalStatusSchema = z.enum(["RESERVED", "ONGOING", "COMPLETED", "CANCELLED"]);
export type RentalStatus = z.infer<typeof rentalStatusSchema>;
export const RENTAL_STATUS_LABELS: Record<RentalStatus, string> = {
  RESERVED: "Réservée",
  ONGOING: "En cours",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
};

export const rentalSchema = z.object({
  id: z.string(),
  status: rentalStatusSchema,
  vehicleId: nullableString,
  vehicleName: z.string(),
  vehiclePlate: nullableString,
  customerId: z.string(),
  customerName: z.string(),
  customerPhone: nullableString,
  driverName: nullableString,
  startAt: z.string(),
  endAt: z.string(),
  pickedUpAt: nullableString,
  returnedAt: nullableString,
  odometerOutKm: z.number().nullable(),
  odometerInKm: z.number().nullable(),
  fuelOut: z.number().nullable(),
  fuelIn: z.number().nullable(),
  gpsDistanceKm: z.number().nullable(),
  /** Montants en chaînes (« 350.00 »). */
  price: nullableString,
  deposit: nullableString,
  currency: currencySchema.catch("MAD"),
  allowedZoneId: nullableString,
  notes: nullableString,
  late: z.boolean(),
});
export type Rental = z.infer<typeof rentalSchema>;

const CURRENCY_SYMBOLS: Record<Currency, string> = { MAD: "DH", EUR: "€", USD: "$" };
const money = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** « 1 200,50 DH » ; « — » sans montant. */
export function formatMoney(amount: string | null | undefined, currency: Currency): string {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  return Number.isFinite(n) ? `${money.format(n)} ${CURRENCY_SYMBOLS[currency]}` : "—";
}

/** « 1 200,5 » ou « 1200.50 » saisi → nombre ; null si vide ; NaN si illisible. */
export function parseAmount(input: string): number | null {
  const v = input.replace(/[\s ]/g, "").replace(",", ".");
  if (!v) return null;
  return /^\d+(\.\d{1,2})?$/.test(v) ? Number(v) : Number.NaN;
}

const RENTALS_KEY = ["rentals"] as const;
const rentalResponse = z.object({ rental: rentalSchema });
const rentalsResponse = z.object({ rentals: z.array(rentalSchema) });

export function useRentals(params: { vehicleId?: string; customerId?: string } = {}) {
  const search = new URLSearchParams();
  if (params.vehicleId) search.set("vehicleId", params.vehicleId);
  if (params.customerId) search.set("customerId", params.customerId);
  const query = search.toString();
  return useQuery({
    queryKey: [...RENTALS_KEY, "list", query],
    queryFn: () => api(`/rentals${query ? `?${query}` : ""}`, { schema: rentalsResponse }),
    staleTime: 30_000,
  });
}

export function useRental(id: string) {
  return useQuery({
    queryKey: [...RENTALS_KEY, id],
    queryFn: () => api(`/rentals/${encodeURIComponent(id)}`, { schema: rentalResponse }),
  });
}

const availabilitySchema = z.object({
  vehicles: z.array(
    z.object({ id: z.string(), name: z.string(), plate: nullableString, available: z.boolean(), reason: nullableString }),
  ),
});
export type VehicleAvailability = z.infer<typeof availabilitySchema>["vehicles"][number];

/** Véhicules et leur disponibilité sur une période (désactivé tant que la période n'est pas saisie). */
export function useAvailability(from: string | null, to: string | null) {
  return useQuery({
    queryKey: [...RENTALS_KEY, "availability", from, to],
    queryFn: () =>
      api(`/vehicles/availability?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`, { schema: availabilitySchema }),
    enabled: Boolean(from && to),
  });
}

export interface RentalInput {
  vehicleId?: string;
  customerId?: string;
  startAt?: string;
  endAt?: string;
  driverName?: string | null;
  price?: number | null;
  deposit?: number | null;
  notes?: string | null;
}

export function useRentalActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: RENTALS_KEY });
  const path = (id: string) => `/rentals/${encodeURIComponent(id)}`;
  return {
    create: useMutation({
      mutationFn: (body: RentalInput) => api("/rentals", { method: "POST", body, schema: rentalResponse }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: RentalInput }) => api(path(id), { method: "PUT", body, schema: rentalResponse }),
      onSuccess: refresh,
    }),
    cancel: (id: string) => api(`${path(id)}/cancel`, { method: "POST", body: {} }).then(refresh),
  };
}

/** Classe les locations pour l'écran : en retard et en cours, à venir, puis passées. */
export function groupRentals(rentals: Rental[]) {
  const byStart = (a: Rental, b: Rental) => a.startAt.localeCompare(b.startAt);
  return {
    ongoing: rentals.filter((r) => r.status === "ONGOING").sort((a, b) => a.endAt.localeCompare(b.endAt)),
    upcoming: rentals.filter((r) => r.status === "RESERVED").sort(byStart),
    past: rentals.filter((r) => r.status === "COMPLETED" || r.status === "CANCELLED").sort((a, b) => b.startAt.localeCompare(a.startAt)),
  };
}
