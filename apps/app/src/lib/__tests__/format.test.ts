import { formatSpeed, relativeTime } from "../format";

const NOW = Date.parse("2026-10-27T22:00:00Z");

describe("relativeTime", () => {
  it("gère l'absence de date", () => {
    expect(relativeTime(null, NOW)).toBe("jamais");
    expect(relativeTime("pas une date", NOW)).toBe("date inconnue");
  });

  it("formate les durées courtes", () => {
    expect(relativeTime("2026-10-27T21:59:50Z", NOW)).toBe("à l'instant");
    expect(relativeTime("2026-10-27T21:55:00Z", NOW)).toMatch(/5 minutes/);
    expect(relativeTime("2026-10-27T19:00:00Z", NOW)).toMatch(/3 heures/);
  });
});

describe("formatSpeed", () => {
  it("arrondit et gère l'absence de valeur", () => {
    expect(formatSpeed(42.6)).toBe("43 km/h");
    expect(formatSpeed(null)).toBe("—");
  });
});
