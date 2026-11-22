// Module location : locataires (/customers) et réservations (/rentals). Voir apps/api/src/routes.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "./api";
import { damageSchema, type Damage } from "./car-diagram";
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
  /** État des lieux : impacts marqués sur le schéma au départ et au retour. */
  damagesOut: z.array(damageSchema).optional().default([]),
  damagesIn: z.array(damageSchema).optional().default([]),
  gpsDistanceKm: z.number().nullable(),
  /** Montants en chaînes (« 350.00 »). */
  price: nullableString,
  deposit: nullableString,
  currency: currencySchema.catch("MAD"),
  allowedZoneId: nullableString,
  /** Absents d'une API pas encore mise à jour : null. */
  pickupLocation: nullableString.optional().default(null),
  returnLocation: nullableString.optional().default(null),
  notes: nullableString,
  late: z.boolean(),
});
export type Rental = z.infer<typeof rentalSchema>;

/**
 * Agences proposées pour la prise en charge et le dépôt (les mêmes que sur le site web de réservation).
 * Liste commune à tous les clients pour l'instant ; « Autre » permet une saisie libre.
 */
export const RENTAL_LOCATIONS = [
  "AGADIR AEROPORT",
  "AGADIR CENTRE-VILLE",
  "CASABLANCA AEROPORT",
  "CASABLANCA CENTRE-VILLE",
  "ESSAOUIRA AEROPORT",
  "FES AEROPORT",
  "FES CENTRE-VILLE",
  "MARRAKECH AEROPORT",
  "MARRAKECH CENTRE-VILLE",
  "OUJDA AEROPORT",
  "RABAT AEROPORT",
  "RABAT CENTRE-VILLE",
  "TANGER AEROPORT",
  "TANGER CENTRE-VILLE",
] as const;

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
  const v = input.replace(/[\s\u202f]/g, "").replace(",", ".");
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
  /** Période entièrement passée : tous les véhicules sont proposés, sans contrôle. */
  past: z.boolean().optional().default(false),
  vehicles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      plate: nullableString,
      available: z.boolean(),
      /** « RENTED » (déjà loué) ou « UNAVAILABLE » (immobilisé). */
      reason: nullableString,
      /** Motif de l'immobilisation : MAINTENANCE, REPAIR, ACCIDENT ou OTHER. */
      unavailabilityReason: nullableString.optional().default(null),
    }),
  ),
});

/** « Déjà loué », « Indisponible : entretien »… ; null si le véhicule est libre. */
export function unavailableLabel(v: { available: boolean; reason: string | null; unavailabilityReason?: string | null }): string | null {
  if (v.available) return null;
  if (v.reason === "RENTED") return "Déjà loué";
  const motives: Record<string, string> = { MAINTENANCE: "entretien", REPAIR: "réparation", ACCIDENT: "accident", OTHER: "autre motif" };
  const motive = v.unavailabilityReason ? motives[v.unavailabilityReason] : undefined;
  return motive ? `Indisponible : ${motive}` : "Indisponible";
}
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
  allowedZoneId?: string | null;
  pickupLocation?: string | null;
  returnLocation?: string | null;
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
    /** Départ du véhicule : passe la location en cours et fige le contrat PDF. */
    pickup: useMutation({
      mutationFn: ({ id, body }: { id: string; body: HandoverInput }) => api(`${path(id)}/pickup`, { method: "POST", body, schema: rentalResponse }),
      onSuccess: refresh,
    }),
    /** Retour du véhicule : termine la location. */
    giveBack: useMutation({
      mutationFn: ({ id, body }: { id: string; body: HandoverInput }) => api(`${path(id)}/return`, { method: "POST", body, schema: rentalResponse }),
      onSuccess: refresh,
    }),
  };
}

export interface HandoverInput {
  odometerKm: number;
  /** Carburant en huitièmes de réservoir (0 à 8). */
  fuelLevel: number;
  /** Impacts relevés sur le schéma du véhicule. */
  damages?: Damage[];
  /** Date réelle (instant ISO) ; absente : maintenant. */
  at?: string;
}

export const FUEL_LEVELS = ["Vide", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8", "Plein"] as const;
export const fuelLabel = (level: number | null | undefined) => (level == null ? "—" : (FUEL_LEVELS[level] ?? `${level}/8`));

export const rentalPhaseSchema = z.enum(["PICKUP", "RETURN"]);
export type RentalPhase = z.infer<typeof rentalPhaseSchema>;

const photoSchema = z.object({ id: z.string(), phase: rentalPhaseSchema, caption: nullableString, createdAt: z.string() });
export type RentalPhoto = z.infer<typeof photoSchema>;

const photosKey = (id: string) => [...RENTALS_KEY, id, "photos"] as const;

export function useRentalPhotos(id: string) {
  return useQuery({
    queryKey: photosKey(id),
    queryFn: () => api(`/rentals/${encodeURIComponent(id)}/photos`, { schema: z.object({ photos: z.array(photoSchema), limitPerPhase: z.number() }) }),
  });
}

export function useRentalPhotoActions(id: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: photosKey(id) });
  const base = `/rentals/${encodeURIComponent(id)}/photos`;
  return {
    upload: useMutation({
      mutationFn: (body: { phase: RentalPhase; data: string; caption?: string | null }) => api(base, { method: "POST", body }),
      onSuccess: refresh,
    }),
    remove: (photoId: string) => api(`${base}/${encodeURIComponent(photoId)}`, { method: "DELETE" }).then(refresh),
  };
}

/** Chemins (relatifs à l'API) des fichiers privés d'une location. */
export const rentalFilePaths = {
  photo: (id: string, photoId: string) => `/rentals/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`,
  contract: (id: string) => `/rentals/${encodeURIComponent(id)}/contract.pdf`,
  returnReport: (id: string) => `/rentals/${encodeURIComponent(id)}/return-report.pdf`,
};

const SETTINGS_KEY = ["tenant", "rental-settings"] as const;
const settingsSchema = z.object({ rentalTerms: nullableString });

export function useRentalSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api("/tenant/rental-settings", { schema: settingsSchema }) });
}

export function useSaveRentalTerms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rentalTerms: string | null) => api("/tenant/rental-settings", { method: "PUT", body: { rentalTerms }, schema: settingsSchema }),
    onSuccess: (data) => queryClient.setQueryData(SETTINGS_KEY, data),
  });
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
