import { parseLocalDateTime, parseTime } from "../dates";
import { formatMoney, groupRentals, parseAmount, type Rental } from "../rentals";

describe("parseTime et parseLocalDateTime", () => {
  it("lit les heures saisies de plusieurs façons", () => {
    expect(parseTime("9:30")).toEqual({ hours: 9, minutes: 30 });
    expect(parseTime("09h05")).toEqual({ hours: 9, minutes: 5 });
    expect(parseTime("18")).toEqual({ hours: 18, minutes: 0 });
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("9:75")).toBeNull();
    expect(parseTime("midi")).toBeNull();
  });

  it("combine date et heure locales", () => {
    const iso = parseLocalDateTime("24/12/2026", "09:30")!;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 11, 24, 9, 30]);
    expect(parseLocalDateTime("31/02/2026", "09:30")).toBeNull();
    expect(parseLocalDateTime("24/12/2026", "")).toBeNull();
  });
});

describe("montants", () => {
  it("lit un montant saisi à la française", () => {
    expect(parseAmount("1 200,50")).toBe(1200.5);
    expect(parseAmount("350")).toBe(350);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("12,345")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
  });

  it("affiche un montant avec la devise du client", () => {
    expect(formatMoney("1200.50", "MAD").replace(/\s/g, " ")).toBe("1 200,5 DH");
    expect(formatMoney("300.00", "EUR").replace(/\s/g, " ")).toBe("300 €");
    expect(formatMoney(null, "USD")).toBe("—");
  });
});

describe("groupRentals", () => {
  const rental = (id: string, status: Rental["status"], startAt: string, endAt: string) => ({ id, status, startAt, endAt }) as Rental;

  it("sépare en cours, à venir et passées, dans l'ordre utile", () => {
    const groups = groupRentals([
      rental("a", "RESERVED", "2026-12-05T09:00:00Z", "2026-12-06T09:00:00Z"),
      rental("b", "ONGOING", "2026-11-20T09:00:00Z", "2026-11-28T09:00:00Z"),
      rental("c", "RESERVED", "2026-12-01T09:00:00Z", "2026-12-02T09:00:00Z"),
      rental("d", "ONGOING", "2026-11-21T09:00:00Z", "2026-11-23T09:00:00Z"),
      rental("e", "COMPLETED", "2026-11-01T09:00:00Z", "2026-11-02T09:00:00Z"),
      rental("f", "CANCELLED", "2026-11-10T09:00:00Z", "2026-11-11T09:00:00Z"),
    ]);
    expect(groups.ongoing.map((r) => r.id)).toEqual(["d", "b"]); // retour le plus proche d'abord
    expect(groups.upcoming.map((r) => r.id)).toEqual(["c", "a"]);
    expect(groups.past.map((r) => r.id)).toEqual(["f", "e"]);
  });
});
