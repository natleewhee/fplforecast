"use client";

import { useSyncExternalStore } from "react";
import { readItem, writeItem } from "./storage";

/* Whether the Squad pitch is drawn in 3D or as the flat 2D pitch. Remembered on
 * this device; 3D is the default. A device that cannot run WebGL falls back to 2D
 * for that visit without changing the saved choice. */

export type PitchView = "3d" | "2d";
const KEY = "fpl-pitch-view";
const listeners = new Set<() => void>();

function read(): PitchView {
  return readItem(KEY) === "2d" ? "2d" : "3d";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function usePitchView(): PitchView {
  return useSyncExternalStore(subscribe, read, () => "3d");
}

export function setPitchView(view: PitchView) {
  writeItem(KEY, view);
  listeners.forEach((l) => l());
}
