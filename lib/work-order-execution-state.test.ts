import test from "node:test"
import assert from "node:assert/strict"

import { describeWorkOrderExecutionState } from "./work-order-execution-state.ts"

test("approved plan freezes while a worker is active", () => {
  const state = describeWorkOrderExecutionState({
    planStatus: "approved",
    currentRun: {
      id: "run-1",
      status: "running",
      summary: "Executing the assignment.",
    },
  })

  assert.equal(state.frozen, true)
  assert.equal(state.canContinue, false)
  assert.equal(state.complete, false)
  assert.match(state.label, /locked/i)
})

test("approved plan stays frozen but can continue after a blocked run", () => {
  const state = describeWorkOrderExecutionState({
    planStatus: "approved",
    latestFinishedRun: {
      id: "run-1",
      status: "blocked",
      summary: "Worker ended in a blocked state.",
      messagePreview: "Reached maximum number of turns.",
    },
  })

  assert.equal(state.frozen, true)
  assert.equal(state.canContinue, true)
  assert.equal(state.complete, false)
  assert.match(state.continuationPoint, /maximum number of turns/)
})

test("approved plan unlocks after completion", () => {
  const state = describeWorkOrderExecutionState({
    planStatus: "approved",
    latestFinishedRun: {
      id: "run-1",
      status: "completed",
      summary: "Mode 2B is ready for CEO test.",
    },
  })

  assert.equal(state.frozen, false)
  assert.equal(state.canContinue, false)
  assert.equal(state.complete, true)
})
