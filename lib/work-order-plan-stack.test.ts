import test from "node:test"
import assert from "node:assert/strict"
import {
  activateMasterPlan,
  addSubPlan,
  getActiveStoredPlan,
  legacyPlanToStack,
  updateActivePlanStatus,
  upsertMasterPlan,
  type StoredWorkOrderPlan,
} from "./work-order-plan-stack.ts"
import type { WorkOrderPlan } from "./work-order-planner.ts"

function plan(title: string): WorkOrderPlan {
  return {
    projectName: "leadqual",
    title,
    priority: "high",
    status: "needs_approval",
    requestSummary: [title],
    doNotBreak: ["Do not break current production behavior."],
    customPercent: 35,
    leveragedPercent: 65,
    customWork: ["Scoped worker assignment"],
    leveragedSystems: ["Existing worker path"],
    steps: [{ title: "Execute", owner: "SDK worker", outcome: "Complete the approved work." }],
    acceptanceCriteria: ["Done"],
    testPlan: ["Verify"],
    executionInstruction: `Run ${title}`,
    executionGate: "Implementation cannot start until this plan is approved.",
  }
}

function stored(title: string): StoredWorkOrderPlan {
  return {
    id: `${title.toLowerCase().replaceAll(" ", "-")}-id`,
    kind: "master",
    goal: title,
    context: "",
    constraints: "",
    acceptanceCriteria: "",
    testPlan: "",
    priority: "high",
    plan: plan(title),
    status: "ready",
    savedAt: "2026-04-21T10:00:00.000Z",
  }
}

test("legacy saved plan migrates into the master plan slot", () => {
  const legacy = stored("Build the master roadmap")
  const stack = legacyPlanToStack(legacy)

  assert.equal(stack.masterPlan?.goal, "Build the master roadmap")
  assert.equal(stack.masterPlan?.kind, "master")
  assert.equal(stack.activePlanId, stack.masterPlan?.id)
  assert.deepEqual(stack.subPlans, [])
})

test("adding a sub-plan keeps the master plan intact and makes the sub-plan active", () => {
  const master = stored("Build the master roadmap")
  const withMaster = upsertMasterPlan(undefined, master)
  const withSubPlan = addSubPlan(withMaster, {
    ...stored("Fix the broken test run"),
    kind: "sub_plan",
  })

  assert.equal(withSubPlan.masterPlan?.goal, "Build the master roadmap")
  assert.equal(withSubPlan.subPlans.length, 1)
  assert.equal(getActiveStoredPlan(withSubPlan)?.goal, "Fix the broken test run")
})

test("master plan can be reactivated after a sub-plan is finished", () => {
  const master = stored("Build the master roadmap")
  const withSubPlan = addSubPlan(upsertMasterPlan(undefined, master), {
    ...stored("Fix the broken test run"),
    kind: "sub_plan",
  })
  const finishedSubPlan = updateActivePlanStatus(withSubPlan, "approved", "2026-04-21T10:05:00.000Z")
  const restoredMaster = activateMasterPlan(finishedSubPlan)

  assert.equal(getActiveStoredPlan(restoredMaster)?.goal, "Build the master roadmap")
  assert.equal(restoredMaster.masterPlan?.status, "ready")
  assert.equal(restoredMaster.subPlans[0]?.status, "approved")
})
