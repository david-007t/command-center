import test from "node:test"
import assert from "node:assert/strict"
import { buildIncidentResponseDirective } from "./project-chat-intent.ts"

test("buildIncidentResponseDirective activates for short incident questions when investigation exists", () => {
  const directive = buildIncidentResponseDirective(
    "why didn't stage deploy?",
    {
      diagnosisCode: "missing_stage_preview_deployment",
      recommendedAction: {
        kind: "trigger_stage_deployment",
        summary: "Use the narrowest safe trigger to force a stage deployment only after GitHub is confirmed.",
      },
    },
  )

  assert.match(directive, /Answer in incident-response mode/i)
  assert.match(directive, /missing_stage_preview_deployment/i)
  assert.match(directive, /trigger_stage_deployment/i)
})

test("buildIncidentResponseDirective stays empty for non-incident questions", () => {
  const directive = buildIncidentResponseDirective("explain the architecture", {
    diagnosisCode: "missing_stage_preview_deployment",
    recommendedAction: {
      kind: "trigger_stage_deployment",
      summary: "Use the narrowest safe trigger to force a stage deployment only after GitHub is confirmed.",
    },
  })

  assert.equal(directive, "")
})
