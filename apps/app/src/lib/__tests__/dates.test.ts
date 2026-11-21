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
