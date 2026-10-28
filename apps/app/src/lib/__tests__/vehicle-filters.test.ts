import type { Vehicle } from "../types";
import { applyFilters, DEFAULT_FILTERS, isFiltered, matchesQuery } from "../vehicle-filters";

const position = (speedKmh: number, fixTime: string) => ({
  latitude: 0,
  longitude: 0,
  speedKmh,
  course: 0,
  fixTime,
  address: null,
  ignition: null,
  motion: null,
});

const v = (overrides: Partial<Vehicle> & { id: string }): Vehicle => ({
  name: overrides.id,
  plate: null,
  status: "online",
  disabled: false,
  lastUpdate: null,
  position: null,
  ...overrides,
});

const fleet: Vehicle[] = [
  v({ id: "a", name: "Benne Éric", plate: "AB-123-CD", position: position(50, "2026-10-28T09:00:00Z") }),
  v({ id: "b", name: "Camion 2", status: "offline", position: position(0, "2026-10-28T10:00:00Z") }),
  v({ id: "c", name: "Camion 10", position: position(0, "2026-10-27T10:00:00Z") }),
  v({ id: "d", name: "Ancien", disabled: true }),
];

const ids = (list: Vehicle[]) => list.map((x) => x.id);

describe("matchesQuery", () => {
  it("ignore casse, accents et séparateurs", () => {
    expect(matchesQuery(fleet[0]!, "eric")).toBe(true);
    expect(matchesQuery(fleet[0]!, "ab123")).toBe(true);
    expect(matchesQuery(fleet[0]!, "123 cd")).toBe(true);
    expect(matchesQuery(fleet[0]!, "camion")).toBe(false);
    expect(matchesQuery(fleet[0]!, "   ")).toBe(true);
  });
});

describe("applyFilters", () => {
  it("par défaut : tout, trié par statut puis nom", () => {
    expect(ids(applyFilters(fleet, DEFAULT_FILTERS))).toEqual(["a", "c", "b", "d"]);
  });

  it("filtre par statut", () => {
    const by = (status: typeof DEFAULT_FILTERS.status) => ids(applyFilters(fleet, { ...DEFAULT_FILTERS, status }));
    expect(by("online")).toEqual(["a", "c"]);
    expect(by("moving")).toEqual(["a"]);
    expect(by("offline")).toEqual(["b", "d"]);
  });

  it("trie par nom (ordre naturel) ou par activité récente", () => {
    expect(ids(applyFilters(fleet, { ...DEFAULT_FILTERS, sort: "name" }))).toEqual(["d", "a", "b", "c"]);
    expect(ids(applyFilters(fleet, { ...DEFAULT_FILTERS, sort: "activity" }))).toEqual(["b", "a", "c", "d"]);
  });

  it("combine recherche et statut", () => {
    expect(ids(applyFilters(fleet, { query: "camion", status: "online", sort: "status" }))).toEqual(["c"]);
  });
});

describe("isFiltered", () => {
  it("le tri seul ne compte pas comme un filtre", () => {
    expect(isFiltered({ ...DEFAULT_FILTERS, sort: "name" })).toBe(false);
    expect(isFiltered({ ...DEFAULT_FILTERS, query: "x" })).toBe(true);
    expect(isFiltered({ ...DEFAULT_FILTERS, status: "moving" })).toBe(true);
  });
});
