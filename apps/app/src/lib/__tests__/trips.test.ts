import { formatDistance, formatDuration } from "../format";
import { periodQuery, periodRange } from "../period";
import { pointsDuring, tripTotals } from "../trips";
import type { Trip } from "../types";

const trip = (overrides: Partial<Trip>): Trip => ({
  startTime: "2026-10-27T08:00:00Z",
  endTime: "2026-10-27T08:30:00Z",
  durationMs: 1_800_000,
  distanceKm: 12.3,
  averageSpeedKmh: 30,
  maxSpeedKmh: 80,
  start: { latitude: 0, longitude: 0 },
  end: { latitude: 0, longitude: 0 },
  ...overrides,
});

describe("tripTotals", () => {
  it("additionne distances et durées, garde la vitesse max", () => {
    expect(tripTotals([trip({}), trip({ distanceKm: 0.1, durationMs: 60_000, maxSpeedKmh: 95.5 })])).toEqual({
      count: 2,
      distanceKm: 12.4,
      durationMs: 1_860_000,
      maxSpeedKmh: 95.5,
    });
    expect(tripTotals([])).toEqual({ count: 0, distanceKm: 0, durationMs: 0, maxSpeedKmh: 0 });
    // Distance non fiable (saut GPS) : comptée dans le nombre et la durée, pas dans la distance.
    expect(tripTotals([trip({}), trip({ distanceKm: null, averageSpeedKmh: null })])).toEqual({
      count: 2,
      distanceKm: 12.3,
      durationMs: 3_600_000,
      maxSpeedKmh: 80,
    });
  });
});

describe("pointsDuring", () => {
  it("ne garde que les positions du trajet", () => {
    const at = (fixTime: string) => ({ latitude: 0, longitude: 0, speedKmh: 0, fixTime });
    const points = [at("2026-10-27T07:59:59Z"), at("2026-10-27T08:00:00Z"), at("2026-10-27T08:30:00Z"), at("2026-10-27T09:00:00Z")];
    expect(pointsDuring(points, trip({})).map((p) => p.fixTime)).toEqual(["2026-10-27T08:00:00Z", "2026-10-27T08:30:00Z"]);
  });
});

describe("periodRange", () => {
  const now = new Date(2026, 9, 28, 15, 30); // 28 octobre, 15 h 30 (heure locale)

  it("aujourd'hui : de minuit à maintenant", () => {
    const r = periodRange("today", now);
    expect(new Date(r.from)).toEqual(new Date(2026, 9, 28));
    expect(new Date(r.to)).toEqual(now);
  });

  it("hier : la journée entière de la veille", () => {
    const r = periodRange("yesterday", now);
    expect(new Date(r.from)).toEqual(new Date(2026, 9, 27));
    expect(new Date(r.to)).toEqual(new Date(2026, 9, 28));
  });

  it("7 jours : aujourd'hui et les 6 jours précédents (moins de 7 jours, limite de l'API)", () => {
    const r = periodRange("week", now);
    expect(new Date(r.from)).toEqual(new Date(2026, 9, 22));
    expect(Date.parse(r.to) - Date.parse(r.from)).toBeLessThanOrEqual(7 * 86_400_000);
  });

  it("encode les dates dans la requête", () => {
    expect(periodQuery({ from: "2026-10-27T00:00:00.000Z", to: "2026-10-28T00:00:00.000Z" })).toBe(
      "from=2026-10-27T00%3A00%3A00.000Z&to=2026-10-28T00%3A00%3A00.000Z",
    );
  });
});

describe("formats", () => {
  it("formatDuration", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(25 * 60_000)).toBe("25 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 05");
    expect(formatDuration(-1)).toBe("—");
  });

  it("formatDistance", () => {
    expect(formatDistance(12.34)).toMatch(/^12,3\s?km$/);
    expect(formatDistance(null)).toBe("—");
  });
});
