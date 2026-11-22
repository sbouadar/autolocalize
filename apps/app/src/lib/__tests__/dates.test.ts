import { formatDateOnly, parseFrenchDate } from "../dates";

describe("parseFrenchDate", () => {
  it("lit les saisies courantes", () => {
    expect(parseFrenchDate("31/12/2026")).toBe("2026-12-31");
    expect(parseFrenchDate(" 1-2-27 ")).toBe("2027-02-01");
    expect(parseFrenchDate("05.03.2027")).toBe("2027-03-05");
  });

  it("refuse une date qui n'existe pas ou mal formée", () => {
    expect(parseFrenchDate("31/02/2027")).toBeNull();
    expect(parseFrenchDate("2027-01-31")).toBeNull();
    expect(parseFrenchDate("demain")).toBeNull();
    expect(parseFrenchDate("")).toBeNull();
  });
});

describe("formatDateOnly", () => {
  it("affiche une date sans heure à la française", () => {
    expect(formatDateOnly("2026-12-31")).toBe("31/12/2026");
    expect(formatDateOnly(null)).toBe("—");
  });
});

describe("calendrier", () => {
  const { isoDay, localDateTime, monthGrid, TIME_OPTIONS, todayIso } = jest.requireActual<typeof import("../dates")>("../dates");

  it("range un mois en semaines du lundi au dimanche", () => {
    // Novembre 2026 commence un dimanche et compte 30 jours.
    const grid = monthGrid(2026, 10);
    expect(grid[0]).toEqual([null, null, null, null, null, null, 1]);
    expect(grid).toHaveLength(6);
    expect(grid[5]).toEqual([30, null, null, null, null, null, null]);
    // Février 2027 commence un lundi : quatre semaines pleines.
    expect(monthGrid(2027, 1)).toHaveLength(4);
  });

  it("donne le jour local et l'instant d'une date et d'une heure choisies", () => {
    expect(isoDay(2026, 0, 5)).toBe("2026-01-05");
    expect(todayIso(new Date(2026, 10, 22, 23, 30))).toBe("2026-11-22");
    expect(localDateTime("2026-11-22", "09:30")).toBe(new Date(2026, 10, 22, 9, 30).toISOString());
    expect(TIME_OPTIONS).toHaveLength(48);
    expect(TIME_OPTIONS[1]!.key).toBe("00:30");
  });
});
