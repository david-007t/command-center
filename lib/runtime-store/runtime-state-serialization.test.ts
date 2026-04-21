import test from "node:test"
import assert from "node:assert/strict"

import {
  projectRowToRuntimeState,
  runtimeStateToProjectUpdate,
  type RuntimeStateProjectRow,
} from "./runtime-state.ts"

test("runtimeStateToProjectUpdate stores canonical runtime fields and metadata snapshot", () => {
  const update = runtimeStateToProjectUpdate(
    {
      projectName: "rbc",
      jobId: "run-123",
      runTemplate: "review_next_move",
      status: "awaiting_ceo",
      summary: "Decision needed.",
      governanceUpdated: false,
      governanceTargets: ["TASKS.md", "HANDOFF.md"],
      updatedTargets: ["TASKS.md"],
      missingTargets: ["HANDOFF.md"],
      completedAt: "2026-04-16T06:29:16.856Z",
      messagePreview: "CEO DECISION NEEDED",
      currentStage: "done",
      stageUpdatedAt: "2026-04-16T06:29:16.856Z",
    },
    {
      phase1: {
        portfolioProject: {
          name: "rbc",
          phase: "BUILD",
          progress: 80,
          blocker: "Old blocker",
          nextAction: "Old next action",
          launchTarget: "2026-05-21",
          latestHandoff: "Old handoff",
          runtimeState: null,
        },
      },
    },
  )

  assert.equal(update.current_run_id, "run-123")
  assert.equal(update.runtime_status, "awaiting_ceo")
  assert.equal(update.current_stage, "done")
  assert.equal(update.runtime_summary, "Decision needed.")
  assert.equal(update.governance_updated, false)
  assert.equal(update.last_run_completed_at, "2026-04-16T06:29:16.856Z")
  assert.equal(update.metadata.runtimeState.messagePreview, "CEO DECISION NEEDED")
  assert.equal(update.metadata.phase1.portfolioProject.runtimeState?.status, "awaiting_ceo")
  assert.equal(update.metadata.phase1.portfolioProject.runtimeState?.currentStage, "done")
})

test("projectRowToRuntimeState prefers metadata.runtimeState and falls back to columns", () => {
  const row: RuntimeStateProjectRow = {
    id: "project-1",
    name: "anelo",
    current_run_id: "run-999",
    runtime_status: "blocked",
    runtime_summary: "Blocked in runtime row.",
    current_stage: "blocked",
    governance_updated: true,
    last_run_completed_at: "2026-04-16T01:00:00.000Z",
    metadata: {
      runtimeState: {
        projectName: "anelo",
        jobId: "run-555",
        runTemplate: "fix_issue",
        status: "healthy",
        summary: "Metadata wins.",
        governanceUpdated: false,
        governanceTargets: ["TASKS.md"],
        updatedTargets: [],
        missingTargets: ["TASKS.md"],
        completedAt: "2026-04-16T02:00:00.000Z",
        messagePreview: "Stored preview",
        currentStage: "verifying",
        stageUpdatedAt: "2026-04-16T02:00:00.000Z",
      },
    },
  }

  const state = projectRowToRuntimeState(row)

  assert.ok(state)
  assert.equal(state?.jobId, "run-555")
  assert.equal(state?.status, "healthy")
  assert.equal(state?.summary, "Metadata wins.")
  assert.equal(state?.messagePreview, "Stored preview")
  assert.equal(state?.currentStage, "verifying")
})

test("projectRowToRuntimeState reconstructs a minimal state from project columns", () => {
  const row: RuntimeStateProjectRow = {
    id: "project-2",
    name: "pulse",
    current_run_id: "run-abc",
    runtime_status: "blocked_on_config",
    runtime_summary: "Missing API key.",
    current_stage: "blocked",
    governance_updated: false,
    last_run_completed_at: "2026-04-16T03:00:00.000Z",
    metadata: {},
  }

  const state = projectRowToRuntimeState(row)

  assert.ok(state)
  assert.equal(state?.projectName, "pulse")
  assert.equal(state?.jobId, "run-abc")
  assert.equal(state?.status, "blocked_on_config")
  assert.equal(state?.summary, "Missing API key.")
  assert.equal(state?.messagePreview, "Missing API key.")
  assert.deepEqual(state?.missingTargets, [])
})
