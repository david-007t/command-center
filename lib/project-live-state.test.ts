import test from "node:test"
import assert from "node:assert/strict"
import { deriveRuntimeStateFromLatestJob } from "./project-live-state.ts"
import { executiveRuntimeSummary, executiveizeRuntimeMessage } from "./executive.ts"
import type { ProjectRuntimeState, RuntimeJob } from "./orchestration.ts"

function job(overrides: Partial<RuntimeJob>): RuntimeJob {
  return {
    id: "job-new",
    type: "project_task",
    runTemplate: "custom",
    projectName: "leadqual",
    instruction: "Fix the current issue.",
    successCriteria: [],
    governanceTargets: ["TASKS.md", "HANDOFF.md"],
    status: "awaiting_ceo",
    createdAt: "2026-04-22T05:14:10.405Z",
    startedAt: "2026-04-22T05:15:00.000Z",
    completedAt: "2026-04-22T05:21:41.085Z",
    logPath: "",
    messagePath: null,
    commentaryPath: null,
    workingDirectory: "/Users/ohsay22/Developer/leadqual",
    summary: "Codex worker completed and surfaced a CEO decision.",
    exitCode: 0,
    pid: null,
    currentStage: "done",
    stageUpdatedAt: "2026-04-22T05:21:41.085Z",
    ...overrides,
  }
}

function runtime(overrides: Partial<ProjectRuntimeState>): ProjectRuntimeState {
  return {
    projectName: "leadqual",
    jobId: "job-old",
    runTemplate: "continue_project",
    status: "awaiting_ceo",
    summary: "Old decision from last week.",
    governanceUpdated: true,
    governanceTargets: ["TASKS.md", "HANDOFF.md"],
    updatedTargets: ["TASKS.md", "HANDOFF.md"],
    missingTargets: [],
    completedAt: "2026-04-16T00:47:58.459Z",
    messagePreview: "Old runtime message.",
    currentStage: "done",
    stageUpdatedAt: "2026-04-16T00:47:58.459Z",
    ...overrides,
  }
}

test("deriveRuntimeStateFromLatestJob prefers a newer job over stale stored runtime state", () => {
  const state = deriveRuntimeStateFromLatestJob({
    projectName: "leadqual",
    existing: runtime({}),
    latestJob: job({}),
    messagePreview: "Fixed the product link and pushed a deployment.",
  })

  assert.equal(state.jobId, "job-new")
  assert.equal(state.status, "awaiting_ceo")
  assert.equal(state.completedAt, "2026-04-22T05:21:41.085Z")
  assert.equal(state.messagePreview, "Fixed the product link and pushed a deployment.")
})

test("deriveRuntimeStateFromLatestJob keeps existing state when it is newer than the latest job", () => {
  const existing = runtime({
    jobId: "job-current",
    completedAt: "2026-04-22T06:00:00.000Z",
    stageUpdatedAt: "2026-04-22T06:00:00.000Z",
    summary: "Current reconciled state.",
  })

  const state = deriveRuntimeStateFromLatestJob({
    projectName: "leadqual",
    existing,
    latestJob: job({ completedAt: "2026-04-22T05:21:41.085Z", stageUpdatedAt: "2026-04-22T05:21:41.085Z" }),
    messagePreview: "Older job message.",
  })

  assert.equal(state, existing)
})

test("deriveRuntimeStateFromLatestJob maps failed worker statuses to blocked runtime state", () => {
  const state = deriveRuntimeStateFromLatestJob({
    projectName: "leadqual",
    existing: null,
    latestJob: job({
      id: "job-failed",
      status: "timed_out",
      summary: "Worker launch timed out.",
      completedAt: "2026-04-22T05:21:41.085Z",
      currentStage: "blocked",
    }),
    messagePreview: "",
  })

  assert.equal(state.status, "blocked")
  assert.equal(state.summary, "Worker launch timed out.")
  assert.equal(state.currentStage, "blocked")
})

test("deriveRuntimeStateFromLatestJob refreshes a same-id runtime snapshot from the latest job row", () => {
  const state = deriveRuntimeStateFromLatestJob({
    projectName: "leadqual",
    existing: runtime({
      jobId: "job-new",
      governanceUpdated: false,
      updatedTargets: [],
      missingTargets: ["TASKS.md", "HANDOFF.md"],
      messagePreview: "Older generic message.",
    }),
    latestJob: job({}),
    messagePreview: "Fresh worker outcome.",
  })

  assert.equal(state.governanceUpdated, true)
  assert.deepEqual(state.updatedTargets, ["TASKS.md", "HANDOFF.md"])
  assert.deepEqual(state.missingTargets, [])
  assert.equal(state.messagePreview, "Fresh worker outcome.")
})

test("executive runtime copy preserves the fresh awaiting-ceo worker outcome", () => {
  const state = runtime({
    jobId: "job-new",
    completedAt: "2026-04-22T05:21:41.085Z",
    stageUpdatedAt: "2026-04-22T05:21:41.085Z",
    summary: "Codex worker completed and surfaced a CEO decision.",
    messagePreview: "Fixed. Commit 9ece20c pushed to origin/main. Product link: https://lead-qualifier-ten.vercel.app",
  })

  assert.match(executiveRuntimeSummary(state), /Codex worker completed/i)
  assert.match(executiveizeRuntimeMessage(state), /Commit 9ece20c pushed/i)
})
