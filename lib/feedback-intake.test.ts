import test from "node:test"
import assert from "node:assert/strict"
import { parseDirectFeedbackIntake } from "./feedback-intake"

test("parseDirectFeedbackIntake recognizes explicit system feedback and auto-launches self-heal work", () => {
  const parsed = parseDirectFeedbackIntake(
    "System feedback for Command Center: prove the operating-system feedback path with a fresh, narrow self-heal run against command-center. Desired outcome: auto-launch the smallest safe command-center worker automatically and keep the tracked outcome visible in SYSTEM_IMPROVEMENTS.md so the end-to-end self-heal path is verified.",
  )

  assert.deepEqual(parsed, {
    scope: "system",
    projectName: "command-center",
    category: "self_heal",
    severity: "medium",
    summary: "prove the operating-system feedback path with a fresh, narrow self-heal run against command-center",
    desiredOutcome:
      "auto-launch the smallest safe command-center worker automatically and keep the tracked outcome visible in SYSTEM_IMPROVEMENTS.md so the end-to-end self-heal path is verified",
    shouldLaunch: true,
  })
})

test("parseDirectFeedbackIntake keeps decision-seeking feedback out of auto-launch", () => {
  const parsed = parseDirectFeedbackIntake(
    "System feedback for Command Center: worker notifications need a redesign. Desired outcome: decide whether Command Center should use chat-thread notices or dashboard toasts before implementation.",
  )

  assert.deepEqual(parsed, {
    scope: "system",
    projectName: "command-center",
    category: "needs_decision",
    severity: "medium",
    summary: "worker notifications need a redesign",
    desiredOutcome: "decide whether Command Center should use chat-thread notices or dashboard toasts before implementation",
    shouldLaunch: false,
  })
})

test("parseDirectFeedbackIntake ignores normal conversation", () => {
  assert.equal(parseDirectFeedbackIntake("What should Command Center work on next?"), null)
})
