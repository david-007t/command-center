import test from "node:test"
import assert from "node:assert/strict"
import { formatRuntimeNotice, mapStoredEventToRuntimeMutation, reasonFromEventType } from "./runtime-event-types.ts"

test("reasonFromEventType maps run lifecycle events to UI reasons", () => {
  assert.equal(reasonFromEventType("run_launched"), "launch")
  assert.equal(reasonFromEventType("run_stage_changed"), "job_update")
  assert.equal(reasonFromEventType("decision_resolved"), "decision")
  assert.equal(reasonFromEventType("project_runtime_updated"), "refresh")
})

test("mapStoredEventToRuntimeMutation converts a database row into a client event", () => {
  const event = mapStoredEventToRuntimeMutation({
    event_type: "run_stage_changed",
    title: "Executing in progress",
    body: "The worker is making the scoped change.",
    visibility_scope: "project",
    created_at: "2026-04-16T02:00:00.000Z",
    payload: {
      projectName: "anelo",
      chatThreadId: "thread-1",
      jobId: "job-1",
      status: "running",
      currentStage: "executing",
    },
  })

  assert.equal(event.projectName, "anelo")
  assert.equal(event.reason, "job_update")
  assert.equal(event.chatThreadId, "thread-1")
  assert.equal(event.currentStage, "executing")
})

test("formatRuntimeNotice prefers the project name when available", () => {
  assert.equal(formatRuntimeNotice({ scope: "project", reason: "job_update", timestamp: 0, projectName: "pulse", title: "Worker launched" }), "pulse: Worker launched")
})
