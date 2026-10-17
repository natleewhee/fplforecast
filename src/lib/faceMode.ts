"use client";

import { useSyncExternalStore } from "react";
import { readItem, writeItem } from "./storage";

/* Whether pitch tokens show a player's photo or their shirt. One choice for
 * every pitch, remembered on this device; photos are the default. */

export type FaceMode = "photo" | "shirt";
const KEY = "fpl-face-mode";
const listeners = new Set<() => void>();

function read(): FaceMode {
  return readItem(KEY) === "shirt" ? "shirt" : "photo";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useFaceMode(): FaceMode {
  return useSyncExternalStore(subscribe, read, () => "photo");
}

export function setFaceMode(mode: FaceMode) {
  writeItem(KEY, mode); // blocked storage: the choice just lasts until reload
  listeners.forEach((l) => l());
}
