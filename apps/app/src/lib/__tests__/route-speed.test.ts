import { distanceKm, speedColor, speedRuns } from "../route-speed";

describe("tracé coloré selon la vitesse", () => {
  it("choisit la couleur de la tranche de vitesse", () => {
    expect(speedColor(0)).toBe("#E8B400");
    expect(speedColor(45)).toBe("#F08C00");
    expect(speedColor(95)).toBe("#B42318");
    expect(speedColor(180)).toBe("#6B0F0F");
  });

  it("regroupe les segments d'une même couleur", () => {
    const p = (lat: number, speedKmh: number) => ({ latitude: lat, longitude: -7, speedKmh });
    const runs = speedRuns([p(33, 10), p(33.01, 20), p(33.02, 100), p(33.03, 100), p(33.04, 10)]);
    expect(runs.map((r) => [r.color, r.coordinates.length])).toEqual([
      ["#E8B400", 2],
      ["#E0461F", 2],
      ["#B42318", 2],
      ["#F08C00", 2],
    ]);
  });

  it("calcule la vitesse à partir des positions quand le traceur n'en remonte pas", () => {
    // 1 km en 50 secondes : 72 km/h → tranche 60–90.
    const a = { latitude: 33, longitude: -7, speedKmh: 0, fixTime: "2026-11-22T10:00:00Z" };
    const lat = 33 + 1 / 111.195;
    const b = { latitude: lat, longitude: -7, speedKmh: 0, fixTime: "2026-11-22T10:00:50Z" };
    expect(distanceKm(a, b)).toBeCloseTo(1, 2);
    expect(speedRuns([a, b])[0]!.color).toBe("#E0461F");
  });
});
