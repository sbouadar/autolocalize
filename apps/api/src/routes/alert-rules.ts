import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { describeDuration, describeHours, parseDays } from "../lib/alert-rules.js";
import { audit } from "../lib/audit.js";
import { ALERT_TYPES } from "../lib/events.js";
import { prisma } from "../lib/prisma.js";
import { firstIssue } from "../lib/tenant-branding.js";

// Règles d'alerte (lecture : tout utilisateur du client ; écriture : son admin) et types d'alerte
// masqués par chaque utilisateur.

const RULES_MAX = 50;
const id = z.string().regex(/^[a-z0-9]{1,64}$/);
const idParam = z.object({ id });

const fields = {
  type: z.enum(["AFTER_HOURS", "OFFLINE_DURATION", "ZONE_DWELL"]),
  name: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .transform((v) => (v ? v : null)),
  vehicleId: id.nullable(),
  zoneId: id.nullable(),
  startMinute: z.number().int().min(0).max(1439).nullable(),
  endMinute: z.number().int().min(0).max(1439).nullable(),
  days: z
    .array(z.number().int().min(1).max(7))
    .min(1, "days : au moins un jour")
    .max(7)
    .transform((d) => [...new Set(d)].sort().join(","))
    .nullable(),
  thresholdMinutes: z.number().int().min(5).max(10_080).nullable(),
  enabled: z.boolean(),
};
const createBody = z.object(fields).partial().required({ type: true }).strict();
const updateBody = z.object(fields).omit({ type: true }).partial().strict();
const prefsBody = z.object({ mutedTypes: z.array(z.enum(ALERT_TYPES as [string, ...string[]])).max(50) }).strict();

const ruleSelect = {
  id: true,
  type: true,
  name: true,
  vehicleId: true,
  zoneId: true,
  startMinute: true,
  endMinute: true,
  days: true,
  thresholdMinutes: true,
  enabled: true,
  vehicle: { select: { name: true } },
  zone: { select: { name: true } },
} as const;

type RuleRow = {
  type: string;
  startMinute: number | null;
  endMinute: number | null;
  days: string | null;
  thresholdMinutes: number | null;
  vehicle: { name: string } | null;
  zone: { name: string } | null;
} & Record<string, unknown>;

function publicRule<T extends RuleRow>(row: T) {
  const { vehicle, zone, days, ...r } = row;
  const { type, startMinute, endMinute, thresholdMinutes } = row;
  const dayList = parseDays(days);
  const summary =
    type === "AFTER_HOURS" && startMinute != null && endMinute != null
      ? `Contact ou mouvement en dehors de : ${describeHours({ startMinute, endMinute, days: dayList })}`
      : type === "OFFLINE_DURATION" && thresholdMinutes
        ? `Traceur sans nouvelle depuis plus de ${describeDuration(thresholdMinutes)}`
        : type === "ZONE_DWELL" && thresholdMinutes
          ? `Plus de ${describeDuration(thresholdMinutes)} dans la zone ${zone?.name ?? "supprimée"}`
          : "Règle incomplète";
  return { ...r, days: dayList, vehicleName: vehicle?.name ?? null, zoneName: zone?.name ?? null, summary };
}

/** Champs obligatoires selon le type ; null si la règle est complète. */
function ruleError(r: { type: string; startMinute?: number | null; endMinute?: number | null; days?: string | null; thresholdMinutes?: number | null; zoneId?: string | null }): string | null {
  if (r.type === "AFTER_HOURS") {
    if (r.startMinute == null || r.endMinute == null) return "Indiquez le début et la fin de la plage horaire autorisée";
    if (r.startMinute === r.endMinute) return "La plage horaire autorisée ne peut pas être vide";
    if (!r.days) return "days : au moins un jour autorisé";
  } else {
    if (!r.thresholdMinutes) return "thresholdMinutes : indiquez la durée";
    if (r.type === "ZONE_DWELL" && !r.zoneId) return "zoneId : choisissez la zone";
  }
  return null;
}

const alertRuleRoutes: FastifyPluginAsync = async (app) => {
  const readers = [app.requireAuth, app.requireRole("TENANT_ADMIN", "AGENT", "VIEWER")];
  const writers = [app.requireAuth, app.requireRole("TENANT_ADMIN")];
  const tenantOf = (request: FastifyRequest) => request.currentUser!.tenantId!;

  /** Véhicule et zone, s'ils sont fournis, doivent appartenir au client. */
  const ownedRefs = async (tenantId: string, vehicleId?: string | null, zoneId?: string | null) => {
    if (vehicleId && !(await prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId }, select: { id: true } }))) return "Véhicule inconnu";
    if (zoneId && !(await prisma.zone.findFirst({ where: { id: zoneId, tenantId }, select: { id: true } }))) return "Zone inconnue";
    return null;
  };

  app.get("/alert-rules", { preHandler: readers }, async (request) => {
    const rows = await prisma.alertRule.findMany({ where: { tenantId: tenantOf(request) }, select: ruleSelect, orderBy: { createdAt: "asc" } });
    return { rules: rows.map(publicRule) };
  });

  app.post("/alert-rules", { preHandler: writers }, async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const tenantId = tenantOf(request);
    const data = parsed.data;
    const error = ruleError(data) ?? (await ownedRefs(tenantId, data.vehicleId, data.zoneId));
    if (error) return reply.badRequest(error);
    if ((await prisma.alertRule.count({ where: { tenantId } })) >= RULES_MAX) return reply.conflict(`${RULES_MAX} règles au plus`);
    // Seuls les champs utiles au type sont gardés.
    const row = await prisma.alertRule.create({
      data: {
        tenantId,
        type: data.type,
        name: data.name ?? null,
        vehicleId: data.vehicleId ?? null,
        enabled: data.enabled ?? true,
        createdBy: request.currentUser!.id,
        ...(data.type === "AFTER_HOURS"
          ? { startMinute: data.startMinute, endMinute: data.endMinute, days: data.days }
          : { thresholdMinutes: data.thresholdMinutes, ...(data.type === "ZONE_DWELL" && { zoneId: data.zoneId }) }),
      },
      select: ruleSelect,
    });
    await audit(request, "alert-rule.create", { tenantId, targetId: row.id, details: { type: row.type } });
    return reply.code(201).send({ rule: publicRule(row) });
  });

  const findOwned = async (request: FastifyRequest) => {
    const parsed = idParam.safeParse(request.params);
    return parsed.success
      ? prisma.alertRule.findFirst({ where: { id: parsed.data.id, tenantId: tenantOf(request) }, select: { ...ruleSelect, tenantId: true } })
      : null;
  };

  app.put("/alert-rules/:id", { preHandler: writers }, async (request, reply) => {
    const existing = await findOwned(request);
    if (!existing) return reply.notFound();
    const parsed = updateBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const merged = { ...existing, ...parsed.data };
    const error = ruleError(merged) ?? (await ownedRefs(existing.tenantId, parsed.data.vehicleId, parsed.data.zoneId));
    if (error) return reply.badRequest(error);
    const row = await prisma.alertRule.update({ where: { id: existing.id as string }, data: parsed.data, select: ruleSelect });
    await audit(request, "alert-rule.update", { tenantId: existing.tenantId, targetId: row.id as string, details: { fields: Object.keys(parsed.data).sort() } });
    return { rule: publicRule(row) };
  });

  app.delete("/alert-rules/:id", { preHandler: writers }, async (request, reply) => {
    const existing = await findOwned(request);
    if (!existing) return reply.notFound();
    await prisma.alertRule.delete({ where: { id: existing.id as string } });
    await audit(request, "alert-rule.delete", { tenantId: existing.tenantId, targetId: existing.id as string, details: { type: existing.type } });
    return reply.code(204).send();
  });

  // Préférences de l'utilisateur : types d'alerte masqués dans sa liste (et, plus tard, ses notifications).
  app.get("/me/alert-preferences", { preHandler: app.requireAuth }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.currentUser!.id }, select: { mutedAlertTypes: true } });
    return { mutedTypes: mutedTypesOf(user.mutedAlertTypes) };
  });

  app.put("/me/alert-preferences", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = prefsBody.safeParse(request.body);
    if (!parsed.success) return reply.badRequest(firstIssue(parsed.error));
    const mutedTypes = [...new Set(parsed.data.mutedTypes)].sort();
    await prisma.user.update({ where: { id: request.currentUser!.id }, data: { mutedAlertTypes: mutedTypes } });
    return { mutedTypes };
  });
};

/** Types masqués lus en base ; une valeur illisible donne une liste vide. */
export function mutedTypesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === "string") : [];
}

export default alertRuleRoutes;
