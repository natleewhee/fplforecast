#!/usr/bin/env node
/* Saves one finished gameweek's real FPL data as a test fixture, so
 * tests/unit/reconcile.test.ts can check the app's live total against FPL's
 * own figure. Needs network access to fantasy.premierleague.com.
 *
 *   node scripts/capture-reconcile.mjs <teamId> <gameweek>
 *
 * Capture a normal week, a week with a transfer hit, and a double gameweek. */
import { mkdirSync, writeFileSync } from "node:fs";

const [teamId, gw] = process.argv.slice(2);
if (!teamId || !gw) {
  console.error("usage: node scripts/capture-reconcile.mjs <teamId> <gameweek>");
  process.exit(1);
}
const api = async (path) => {
  const res = await fetch(`https://fantasy.premierleague.com/api${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
};

const [bootstrap, live, fixtures, picks] = await Promise.all([
  api("/bootstrap-static/"),
  api(`/event/${gw}/live/`),
  api(`/fixtures/?event=${gw}`),
  api(`/entry/${teamId}/event/${gw}/picks/`),
]);
// Keep the file small: only the bootstrap fields the tracker reads.
const slim = {
  events: bootstrap.events.map(({ id, is_current, is_next, finished, data_checked, average_entry_score, deadline_time }) => ({
    id, is_current, is_next, finished, data_checked, average_entry_score, deadline_time,
  })),
  elements: bootstrap.elements.map(({ id, team, element_type, web_name, code }) => ({ id, team, element_type, web_name, code })),
  teams: bootstrap.teams.map(({ id, short_name }) => ({ id, short_name })),
};
mkdirSync("tests/fixtures/reconcile", { recursive: true });
const file = `tests/fixtures/reconcile/gw${gw}-${teamId}.json`;
writeFileSync(file, JSON.stringify({ gameweek: Number(gw), bootstrap: slim, live, fixtures, picks }));
console.log(`wrote ${file} (points ${picks.entry_history?.points}, hit ${picks.entry_history?.event_transfers_cost})`);
