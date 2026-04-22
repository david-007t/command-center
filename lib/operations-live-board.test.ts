import test from "node:test"
import assert from "node:assert/strict"
import { mapJobToOperationsRun, splitOperationsRuns } from "./operations-run-card.ts"
import type { RuntimeJob } from "./orchestration.ts"

function job(overrides: Partial<RuntimeJob>): RuntimeJob {
  return {
    id: "run-1",
    type: "project_task",
    runTemplate: "continue_project",
    projectName: "leadqual",
    instruction: "Fix the current issue.",
    successCriteria: [],
    governanceTargets: [],
    status: "running",
    createdAt: "2026-04-22T07:00:00.000Z",
    startedAt: "2026-04-22T07:00:01.000Z",
    completedAt: null,
    logPath: "",
    messagePath: null,
    commentaryPath: null,
    workingDirectory: "/Users/ohsay22/Developer/leadqual",
    summary: "Verifying the result.",
    exitCode: null,
    pid: null,
    currentStage: "verifying",
    stageUpdatedAt: "2026-04-22T07:05:00.000Z",
    ...overrides,
  }
}

test("splitOperationsRuns keeps live and recently finished runs separate", () => {
  const running = mapJobToOperationsRun(job({ id: "running", status: "running" }))
  const completed = mapJobToOperationsRun(
    job({
      id: "completed",
      status: "completed",
      completedAt: "2026-04-22T07:10:00.000Z",
      currentStage: "done",
      summary: "Worker completed the product link fix.",
    }),
  )

  const result = splitOperationsRuns([completed, running], new Date("2026-04-22T07:05:30.000Z"))

  assert.deepEqual(result.activeRuns.map((run) => run.id), ["running"])
  assert.deepEqual(result.recentRuns.map((run) => run.id), ["completed"])
  assert.equal(result.recentRuns[0]?.oneLineResult, "Worker completed the product link fix.")
})

test("mapJobToOperationsRun writes a concise fallback result for failed work", () => {
  const run = mapJobToOperationsRun(
    job({
      status: "failed",
      summary: "",
      completedAt: "2026-04-22T07:10:00.000Z",
      currentStage: "blocked",
    }),
  )

  assert.equal(run.oneLineResult, "Worker stopped before completion.")
})

test("splitOperationsRuns moves stale running runs into recent timed-out results", () => {
  const stale = mapJobToOperationsRun(
    job({
      id: "stale",
      status: "running",
      summary: "Verifying the result.",
      stageUpdatedAt: "2026-04-22T07:00:00.000Z",
    }),
  )

  const result = splitOperationsRuns([stale], new Date("2026-04-22T15:32:00.000Z"))

  assert.deepEqual(result.activeRuns, [])
  assert.equal(result.recentRuns[0]?.id, "stale")
  assert.equal(result.recentRuns[0]?.status, "timed_out")
  assert.equal(result.recentRuns[0]?.statusLabel, "Timed out")
  assert.equal(
    result.recentRuns[0]?.oneLineResult,
    "Worker heartbeat was lost. The run is no longer live; retry it if the work is still needed.",
  )
})
