import test from "node:test"
import assert from "node:assert/strict"

import { buildFeedbackWorkOrderDraft } from "./feedback-work-order.ts"

test("buildFeedbackWorkOrderDraft turns CEO feedback into an executable fix draft", () => {
  const draft = buildFeedbackWorkOrderDraft({
    projectName: "leadqual",
    feedback: "Find My Clients returned 'No businesses found' with no detailed reason.",
    expectedBehavior: "Show whether the API failed, parsing failed, or filters removed all results.",
    productUrl: "https://lead-qualifier-ten.vercel.app",
  })

  assert.match(draft.goal, /Find My Clients/)
  assert.match(draft.context, /CEO test feedback/)
  assert.match(draft.context, /API failed/)
  assert.match(draft.context, /lead-qualifier-ten/)
  assert.match(draft.acceptanceCriteria, /plain English/)
  assert.match(draft.testPlan, /Reproduce the reported issue/)
  assert.equal(draft.priority, "high")
})

test("buildFeedbackWorkOrderDraft handles sparse feedback without blocking plan creation", () => {
  const draft = buildFeedbackWorkOrderDraft({
    projectName: "leadqual",
    feedback: "",
  })

  assert.match(draft.goal, /Fix the leadqual issue/)
  assert.match(draft.context, /No detailed feedback/)
})
