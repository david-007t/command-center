import test from "node:test"
import assert from "node:assert/strict"
import { buildProjectQuickActions } from "./project-chat-actions.ts"

test("buildProjectQuickActions prefers investigation-native prompts when an active investigation exists", () => {
  const actions = buildProjectQuickActions("anelo", {
    title: "Investigate missing stage preview",
    diagnosisCode: "missing_stage_preview_deployment",
    suggestedInstruction: "Investigate why anelo does not yet have a verified Vercel stage preview deployment.",
    recommendedAction: {
      kind: "trigger_stage_deployment",
      summary: "Use the narrowest safe trigger to force a stage deployment only after GitHub is confirmed.",
    },
  })

  assert.equal(actions[0], "What does anelo need right now?")
  assert.equal(actions[1], "Status update")
  assert.equal(actions[2], "What is the current decision in anelo?")
  assert.equal(actions[4], "Proceed")
})

test("buildProjectQuickActions falls back to generic project prompts without an investigation", () => {
  const actions = buildProjectQuickActions("pulse", null)

  assert.deepEqual(actions, [
    "What does pulse need right now?",
    "Status update",
    "What is the current decision in pulse?",
    "Why is it queued?",
    "Proceed",
  ])
})
