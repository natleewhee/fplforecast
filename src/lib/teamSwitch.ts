/* The Team tab's Now/Next switch tells the pitch it has just been shown by a switch, so the
 * camera can sweep in rather than appear. A plain page load or scroll does not sweep. */

let last = -Infinity;

/** Called by the Team tab when the viewer (or the deadline) changes half. */
export function markTeamSwitch(now = Date.now()): void {
  last = now;
}

/** True for a short while after a switch: long enough for the shown half's pitch to start. */
export function justSwitched(now = Date.now(), within = 1500): boolean {
  return now - last >= 0 && now - last <= within;
}
