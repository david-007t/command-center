import test from "node:test"
import assert from "node:assert/strict"
import { deriveProjectOperatingState } from "./project-operating-state.ts"

test("deriveProjectOperatingState marks project pending CEO test when runtime QA evidence is missing", () => {
  const state = deriveProjectOperatingState({
    phase: "BUILD",
    runtimeStatus: "stale_governance",
    qaChecklist: "Result: FAIL\nRuntime QA evidence is still missing.",
    securityChecklist: "Result: FAIL\nRemaining dependency checks.",
    latestFinishedRunStatus: "completed",
    latestFinishedRunSummary: "Codex worker completed the requested project task.",
  })

  assert.equal(state.status, "pending_ceo_test")
  assert.equal(state.label, "Pending CEO test")
  assert.equal(state.tone, "purple")
  assert.match(state.summary, /ready for you to test/i)
  assert.match(state.nextAction, /Open the product/i)
  assert.match(state.blocker, /CEO product-flow test/i)
})

test("deriveProjectOperatingState marks running when a worker is active", () => {
  const state = deriveProjectOperatingState({
    phase: "BUILD",
    runtimeStatus: "healthy",
    qaChecklist: "Result: FAIL\nRuntime QA evidence is still missing.",
    latestActiveRunStatus: "running",
  })

  assert.equal(state.status, "worker_running")
  assert.equal(state.label, "Worker running")
  assert.equal(state.tone, "purple")
})

test("deriveProjectOperatingState marks blocked statuses before QA test", () => {
  const state = deriveProjectOperatingState({
    phase: "BUILD",
    runtimeStatus: "blocked",
    qaChecklist: "Result: FAIL\nRuntime QA evidence is still missing.",
  })

  assert.equal(state.status, "blocked")
  assert.equal(state.label, "Blocked")
  assert.equal(state.tone, "red")
})
