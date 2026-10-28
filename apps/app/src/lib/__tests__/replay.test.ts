import { frameAt, replayBounds } from "../replay";

const p = (fixTime: string, latitude: number, speedKmh: number) => ({ latitude, longitude: -7, speedKmh, fixTime });
const points = [p("2026-10-28T08:00:00Z", 33.0, 0), p("2026-10-28T08:10:00Z", 34.0, 50), p("2026-10-28T08:20:00Z", 34.0, 0)];
const at = (iso: string) => Date.parse(iso);

describe("replayBounds", () => {
  it("début et fin du tracé, ou null s'il est trop court", () => {
    expect(replayBounds(points)).toEqual({ start: at("2026-10-28T08:00:00Z"), end: at("2026-10-28T08:20:00Z") });
    expect(replayBounds(points.slice(0, 1))).toBeNull();
  });
});

describe("frameAt", () => {
  it("interpole la position entre deux points", () => {
    const f = frameAt(points, at("2026-10-28T08:05:00Z"))!;
    expect(f.latitude).toBeCloseTo(33.5);
    expect(f.speedKmh).toBe(0);
  });

  it("reste sur le premier ou le dernier point hors du tracé", () => {
    expect(frameAt(points, at("2026-10-28T07:00:00Z"))!.latitude).toBe(33);
    expect(frameAt(points, at("2026-10-28T09:00:00Z"))!.latitude).toBe(34);
    expect(frameAt([], 0)).toBeNull();
  });

  it("donne la vitesse mesurée au point atteint", () => {
    expect(frameAt(points, at("2026-10-28T08:10:00Z"))!.speedKmh).toBe(50);
  });
});
