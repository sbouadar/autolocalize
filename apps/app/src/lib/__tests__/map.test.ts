import { DEFAULT_REGION, positionedVehicles, regionFor, sortVehicles } from "../map";
import type { Vehicle } from "../types";

function vehicle(overrides: Partial<Vehicle>): Vehicle {
  return {
    id: "v",
    name: "V",
    plate: null,
    status: "online",
    disabled: false,
    lastUpdate: null,
    position: null,
    ...overrides,
  };
}

const position = { speedKmh: 0, course: 0, fixTime: "2026-10-28T10:00:00Z", address: null, ignition: null, motion: null };

describe("sortVehicles", () => {
  it("place les véhicules en ligne d'abord et les désactivés en dernier, puis par nom", () => {
    const sorted = sortVehicles([
      vehicle({ id: "1", name: "Bravo", status: "offline" }),
      vehicle({ id: "2", name: "Zoulou", status: "online" }),
      vehicle({ id: "3", name: "Alpha", status: "online", disabled: true }),
      vehicle({ id: "4", name: "Charlie", status: "unknown" }),
      vehicle({ id: "5", name: "alpha", status: "online" }),
    ]);
    expect(sorted.map((v) => v.id)).toEqual(["5", "2", "1", "4", "3"]);
  });

  it("trie les numéros dans l'ordre naturel et ne modifie pas le tableau d'origine", () => {
    const input = [vehicle({ id: "a", name: "Camion 10" }), vehicle({ id: "b", name: "Camion 9" })];
    expect(sortVehicles(input).map((v) => v.id)).toEqual(["b", "a"]);
    expect(input.map((v) => v.id)).toEqual(["a", "b"]);
  });
});

describe("positionedVehicles", () => {
  it("ne garde que les véhicules ayant une position", () => {
    const list = [vehicle({ id: "1" }), vehicle({ id: "2", position: { ...position, latitude: 1, longitude: 2 } })];
    expect(positionedVehicles(list).map((v) => v.id)).toEqual(["2"]);
  });
});

describe("regionFor", () => {
  it("renvoie la vue par défaut sans point", () => {
    expect(regionFor([])).toEqual(DEFAULT_REGION);
  });

  it("garde une étendue minimale pour un seul point", () => {
    const region = regionFor([{ latitude: 33.57, longitude: -7.59 }]);
    expect(region.latitude).toBeCloseTo(33.57);
    expect(region.longitude).toBeCloseTo(-7.59);
    expect(region.latitudeDelta).toBeGreaterThan(0);
    expect(region.longitudeDelta).toBeGreaterThan(0);
  });

  it("englobe tous les points avec une marge", () => {
    const region = regionFor([
      { latitude: 48, longitude: 2 },
      { latitude: 34, longitude: -7 },
    ]);
    expect(region.latitude).toBeCloseTo(41);
    expect(region.longitude).toBeCloseTo(-2.5);
    expect(region.latitudeDelta).toBeGreaterThan(14);
    expect(region.longitudeDelta).toBeGreaterThan(9);
  });
});
