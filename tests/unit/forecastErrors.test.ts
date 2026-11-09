import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INVALID_TEAM_ID_MESSAGE,
  forecastErrorMessage,
  isValidTeamIdInput,
} from "@/lib/forecastErrors";

test("a team ID is 1 to 9 digits with no leading zero", () => {
  for (const ok of ["1", "42", "1168513", "123456789"]) assert.equal(isValidTeamIdInput(ok), true, ok);
  for (const bad of ["", "0", "012", "1234567890", "12a", " 12", "1.5", "-3"]) {
    assert.equal(isValidTeamIdInput(bad), false, bad);
  }
});

test("404 names the team and says to check the ID", () => {
  const msg = forecastErrorMessage(404, "777");
  assert.match(msg, /no team with ID 777/);
  assert.match(msg, /Check the number/);
});

test("422 says the team has no squad yet and when to come back", () => {
  const msg = forecastErrorMessage(422, "777");
  assert.match(msg, /Team 777 has no squad recorded/);
  assert.match(msg, /Check back once the next gameweek finishes/);
});

test("503 says there is nothing to forecast yet and to retry", () => {
  const msg = forecastErrorMessage(503, "777");
  assert.match(msg, /nothing to forecast yet/);
  assert.match(msg, /Try again/);
});

test("400 explains the ID format; other statuses ask for a retry", () => {
  assert.equal(forecastErrorMessage(400, "x"), INVALID_TEAM_ID_MESSAGE);
  assert.match(forecastErrorMessage(502, "1"), /Try again in a minute/);
});
