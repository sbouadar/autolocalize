import { colors } from "../theme";
import type { VehiclePosition } from "../types";
import { lastSeen, movementLabel, vehicleLabel, vehicleState, vehicleStatus } from "../vehicles";

const position: VehiclePosition = {
  latitude: 33.57,
  longitude: -7.59,
  speedKmh: 0,
  course: 0,
  fixTime: "2026-10-28T10:00:00Z",
  address: null,
  ignition: null,
  motion: null,
};

describe("movementLabel", () => {
  it("signale l'absence de position", () => {
    expect(movementLabel(null)).toBe("Position inconnue");
  });

  it("se fie à l'attribut motion quand le traceur le fournit", () => {
    expect(movementLabel({ ...position, motion: true, speedKmh: 1.4 })).toBe("En mouvement · 1 km/h");
    expect(movementLabel({ ...position, motion: false, speedKmh: 12 })).toBe("À l’arrêt");
  });

  it("sinon, ignore les petites vitesses (bruit GPS)", () => {
    expect(movementLabel({ ...position, speedKmh: 2 })).toBe("À l’arrêt");
    expect(movementLabel({ ...position, speedKmh: 42.4 })).toBe("En mouvement · 42 km/h");
  });
});

describe("lastSeen", () => {
  it("préfère l'heure de la position au dernier contact", () => {
    expect(lastSeen({ position, lastUpdate: "2026-10-28T11:00:00Z" })).toBe("2026-10-28T10:00:00Z");
    expect(lastSeen({ position: null, lastUpdate: "2026-10-28T11:00:00Z" })).toBe("2026-10-28T11:00:00Z");
    expect(lastSeen({ position: null, lastUpdate: null })).toBeNull();
  });
});

describe("vehicleLabel", () => {
  it("utilise le nom, sinon la plaque, sinon un libellé générique", () => {
    expect(vehicleLabel({ name: "GPS1", plate: "AB-123-CD" })).toBe("GPS1");
    expect(vehicleLabel({ name: " ", plate: "AB-123-CD" })).toBe("AB-123-CD");
    expect(vehicleLabel({ name: "", plate: null })).toBe("Véhicule sans nom");
  });
});

describe("vehicleStatus", () => {
  it("donne la priorité à l'état désactivé", () => {
    expect(vehicleStatus({ status: "online", disabled: true })).toEqual({
      label: "Désactivé",
      color: colors.danger,
    });
  });

  it("traduit chaque statut", () => {
    expect(vehicleStatus({ status: "online", disabled: false }).label).toBe("En ligne");
    expect(vehicleStatus({ status: "offline", disabled: false }).label).toBe("Hors ligne");
    expect(vehicleStatus({ status: "unknown", disabled: false }).label).toBe("Statut inconnu");
  });
});

describe("vehicleState", () => {
  const pos = { latitude: 0, longitude: 0, speedKmh: 0, course: 0, fixTime: "2026-11-21T10:00:00Z", address: null, ignition: null, motion: null };

  it("distingue en route et à l'arrêt pour un traceur en ligne", () => {
    expect(vehicleState({ status: "online", disabled: false, position: { ...pos, speedKmh: 50 } }).key).toBe("moving");
    expect(vehicleState({ status: "online", disabled: false, position: { ...pos, motion: false, speedKmh: 50 } }).key).toBe("stopped");
    expect(vehicleState({ status: "online", disabled: false, position: null }).label).toBe("À l’arrêt");
  });

  it("classe hors ligne un traceur hors ligne ou au statut inconnu, et donne la priorité à l'état désactivé", () => {
    expect(vehicleState({ status: "offline", disabled: false, position: { ...pos, speedKmh: 50 } }).label).toBe("Hors ligne");
    expect(vehicleState({ status: "unknown", disabled: false, position: null })).toMatchObject({ key: "offline", label: "Statut inconnu" });
    expect(vehicleState({ status: "online", disabled: true, position: { ...pos, speedKmh: 50 } }).key).toBe("disabled");
  });
});
