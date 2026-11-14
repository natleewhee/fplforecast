import test from "node:test";
import assert from "node:assert/strict";
import { justSwitched, markTeamSwitch } from "@/lib/teamSwitch";

test("the pitch sweeps in only just after a Now/Next switch", () => {
  assert.equal(justSwitched(1_000), false, "nothing switched yet");
  markTeamSwitch(10_000);
  assert.equal(justSwitched(10_400), true);
  assert.equal(justSwitched(11_500), true);
  assert.equal(justSwitched(11_600), false, "too long ago");
  assert.equal(justSwitched(9_000), false, "a clock earlier than the switch does not count");
});
