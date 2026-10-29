// Contrats de l'API (apps/api), validés à l'exécution avec Zod.
// À garder synchronisés avec les routes du backend. Les champs inconnus sont ignorés,
// ce qui permet au backend d'ajouter des champs (back-office) sans casser l'application.
import { z } from "zod";

const nullableString = z.string().nullable();

export const roleSchema = z.enum(["SUPER_ADMIN", "TENANT_ADMIN", "VIEWER"]);
export type Role = z.infer<typeof roleSchema>;

/** Branding public (avant connexion) : GET /public/tenants/:slug/branding */
export const publicBrandingSchema = z.object({
  name: z.string(),
  logoUrl: nullableString,
  primaryColor: z.string(),
  secondaryColor: z.string(),
});
export type PublicBranding = z.infer<typeof publicBrandingSchema>;

/** Client complet (après connexion), modifiable plus tard par l'admin client dans le back-office. */
export const tenantSchema = publicBrandingSchema.extend({
  id: z.string(),
  slug: z.string(),
  address: nullableString,
  phone: nullableString,
  email: nullableString,
});
export type Tenant = z.infer<typeof tenantSchema>;

/** GET /me */
export const meSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    role: roleSchema,
    /** Mot de passe provisoire : à changer avant d'accéder au reste de l'application. */
    mustChangePassword: z.boolean().optional().default(false),
  }),
  tenant: tenantSchema.nullable(),
});
export type Me = z.infer<typeof meSchema>;

export const deviceStatusSchema = z.enum(["online", "offline", "unknown"]).catch("unknown");
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

export const vehiclePositionSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  speedKmh: z.number(),
  course: z.number(),
  fixTime: z.string(),
  address: nullableString,
  ignition: z.boolean().nullable(),
  motion: z.boolean().nullable(),
});
export type VehiclePosition = z.infer<typeof vehiclePositionSchema>;

export const vehicleSchema = z.object({
  id: z.string(),
  name: z.string(),
  plate: nullableString,
  tenantId: z.string().optional(),
  status: deviceStatusSchema,
  disabled: z.boolean(),
  lastUpdate: nullableString,
  position: vehiclePositionSchema.nullable(),
});
export type Vehicle = z.infer<typeof vehicleSchema>;

/** GET /vehicles */
export const vehiclesResponseSchema = z.object({
  liveDataAvailable: z.boolean(),
  vehicles: z.array(vehicleSchema),
});
export type VehiclesResponse = z.infer<typeof vehiclesResponseSchema>;

/** GET /vehicles/:id */
export const vehicleResponseSchema = z.object({
  liveDataAvailable: z.boolean(),
  vehicle: vehicleSchema,
});

const pointSchema = z.object({ latitude: z.number(), longitude: z.number() });
const placeSchema = pointSchema.extend({ address: nullableString });
export type Place = z.infer<typeof placeSchema>;

export const tripSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  durationMs: z.number(),
  /** null : distance faussée par une position GPS aberrante (saut au point 0,0), non comptée. */
  distanceKm: z.number().nullable(),
  averageSpeedKmh: z.number().nullable(),
  maxSpeedKmh: z.number(),
  start: pointSchema,
  end: pointSchema,
});
export type Trip = z.infer<typeof tripSchema>;

/**
 * GET /vehicles/:id/trips?from&to (31 jours au plus). Adresses du premier départ et de la dernière
 * arrivée seulement (null si pas encore connues) ; departure et arrival sont null sans trajet.
 */
export const tripsResponseSchema = z.object({
  trips: z.array(tripSchema),
  departure: placeSchema.nullable(),
  arrival: placeSchema.nullable(),
});

export const routePointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  speedKmh: z.number(),
  fixTime: z.string(),
});
export type RoutePoint = z.infer<typeof routePointSchema>;

/** GET /vehicles/:id/route?from&to (7 jours au plus, 2000 points au plus) */
export const routeResponseSchema = z.object({ truncated: z.boolean(), points: z.array(routePointSchema) });

const activitySchema = z.object({
  distanceKm: z.number(),
  drivingMs: z.number(),
  engineHoursMs: z.number(),
  maxSpeedKmh: z.number(),
  trips: z.number(),
});

/** GET /dashboard/kpis?from&to (31 jours au plus) */
export const kpisResponseSchema = z.object({
  liveDataAvailable: z.boolean(),
  reportsAvailable: z.boolean(),
  fleet: z.object({
    total: z.number(),
    online: z.number(),
    offline: z.number(),
    unknown: z.number(),
    moving: z.number(),
  }),
  totals: activitySchema.nullable(),
  vehicles: z.array(activitySchema.extend({ id: z.string(), name: z.string(), plate: nullableString })),
});
export type Kpis = z.infer<typeof kpisResponseSchema>;
