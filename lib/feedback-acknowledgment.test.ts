import test from "node:test"
import assert from "node:assert/strict"
import { buildFeedbackAcknowledgment } from "./feedback-acknowledgment.ts"

test("buildFeedbackAcknowledgment confirms feedback was captured and logged when no worker launches", () => {
  const message = buildFeedbackAcknowledgment({
    status: "logged",
    scope: "system",
    category: "product_improvement",
    summary: "Feedback acknowledgment is too vague.",
  })

  assert.match(message, /Feedback captured\./)
  assert.match(message, /Logged as tracked system input for Command Center\./)
  assert.match(message, /Next step: queued for review in the operating system. No worker launched yet\./)
})

test("buildFeedbackAcknowledgment confirms feedback was captured and worker auto-launch is active", () => {
  const message = buildFeedbackAcknowledgment({
    status: "actioning",
    scope: "system",
    category: "self_heal",
    summary: "Acknowledge and auto-launch fixes more clearly.",
    jobId: "job_123",
    jobType: "system_task",
  })

  assert.match(message, /Feedback captured\./)
  assert.match(message, /Logged as tracked system input for Command Center\./)
  assert.match(message, /Auto-launch started: system task job_123 is now working this feedback\./)
})
