import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newDamages, readDamages } from "../src/lib/car-diagram.js";

describe("état des lieux : impacts", () => {
  it("repère les impacts du retour absents au départ", () => {
    const out = readDamages([{ x: 0.2, y: 0.1, type: "SCRATCH", note: null }]);
    const back = readDamages([
      { x: 0.21, y: 0.105, type: "SCRATCH", note: null },
      { x: 0.2, y: 0.1, type: "DENT", note: null },
      { x: 0.8, y: 0.9, type: "SCRATCH", note: null },
    ]);
    assert.deepEqual([...newDamages(out, back)], [1, 2]);
  });

  it("lit une valeur de base illisible comme une liste vide", () => {
    assert.deepEqual(readDamages(null), []);
    assert.deepEqual(readDamages("n'importe quoi"), []);
    assert.deepEqual(readDamages([{ x: 3, y: 0, type: "DENT" }]), []);
  });
});
