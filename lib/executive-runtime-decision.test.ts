import test from "node:test"
import assert from "node:assert/strict"
import { executiveDecisionFromRuntime } from "./executive.ts"
import type { ProjectRuntimeState } from "./orchestration.ts"

test("executiveDecisionFromRuntime returns null for healthy runtime state with no real decision", () => {
  const runtimeState: ProjectRuntimeState = {
    projectName: "anelo",
    jobId: "job_123",
    runTemplate: "custom",
    status: "healthy",
    summary: "Codex worker completed the requested project task.",
    governanceUpdated: true,
    governanceTargets: ["TASKS.md", "HANDOFF.md"],
    updatedTargets: ["TASKS.md", "HANDOFF.md"],
    missingTargets: [],
    completedAt: "2026-04-15T10:32:23.942Z",
    messagePreview:
      "Outcome\n\nAnelo is now split at the git/workflow level so production stays on main and ongoing work can continue on stage.",
    currentStage: "done",
    stageUpdatedAt: "2026-04-15T10:32:23.942Z",
  }

  assert.equal(executiveDecisionFromRuntime("anelo", runtimeState), null)
})

test("executiveDecisionFromRuntime returns actionable options for the RBC workflow split decision", () => {
  const runtimeState: ProjectRuntimeState = {
    projectName: "rbc",
    jobId: "job_456",
    runTemplate: "review_next_move",
    status: "awaiting_ceo",
    summary: "CEO decision required on the primary workflow path.",
    governanceUpdated: true,
    governanceTargets: ["TASKS.md", "HANDOFF.md"],
    updatedTargets: ["TASKS.md", "HANDOFF.md"],
    missingTargets: [],
    completedAt: "2026-04-15T10:32:23.942Z",
    messagePreview: "CEO DECISION NEEDED: choose whether v1 centers pipeline/run.py queue processing or run_days.py day-compilation flow.",
    currentStage: "done",
    stageUpdatedAt: "2026-04-15T10:32:23.942Z",
  }

  const decision = executiveDecisionFromRuntime("rbc", runtimeState)

  assert.ok(decision)
  assert.equal(decision?.options?.length, 2)
})
