import { pressPosition } from "../CarDamageDiagram";

describe("pressPosition", () => {
  it("prend la position fournie par le mobile", () => {
    expect(pressPosition({ locationX: 40, locationY: 90 }, null)).toEqual({ x: 40, y: 90 });
  });

  it("calcule la position sur le web à partir du clic et du cadre du schéma", () => {
    // Le navigateur ne donne pas locationX : c'était la cause des impacts envoyés sans position.
    expect(pressPosition({ clientX: 350, clientY: 500 }, { left: 300, top: 320 })).toEqual({ x: 50, y: 180 });
  });

  it("ne renvoie rien si la position est inconnue", () => {
    expect(pressPosition({}, null)).toBeNull();
    expect(pressPosition({ locationX: Number.NaN, locationY: 3 }, null)).toBeNull();
  });
});
