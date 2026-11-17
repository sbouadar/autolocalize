// Zones que l'utilisateur a choisi d'afficher sur la carte. Aucune par défaut : une carte couverte
// de cercles devient illisible. Le choix, fait dans l'écran des zones, vaut aussi pour la carte en
// direct ; il est gardé en mémoire le temps de la session d'utilisation.
import { useSyncExternalStore } from "react";

let selected: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function set(next: ReadonlySet<string>) {
  selected = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSelectedZoneIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => selected,
    () => selected,
  );
}

export function toggleZoneSelection(id: string) {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  set(next);
}

export function selectZone(id: string) {
  if (!selected.has(id)) set(new Set(selected).add(id));
}

/** Oublie le choix (changement de compte, tests). */
export function clearZoneSelection() {
  if (selected.size > 0) set(new Set());
}
