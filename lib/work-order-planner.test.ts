import test from "node:test"
import assert from "node:assert/strict"
import { buildWorkOrderPlan, createBlankWorkOrderDraft } from "./work-order-planner.ts"

test("createBlankWorkOrderDraft starts without inherited project text", () => {
  assert.deepEqual(createBlankWorkOrderDraft(), {
    goal: "",
    context: "",
    constraints: "",
    acceptanceCriteria: "",
    testPlan: "",
    priority: "high",
  })
})

test("buildWorkOrderPlan creates an approval-gated plan before execution", () => {
  const plan = buildWorkOrderPlan({
    projectName: "leadqual",
    goal: "Refactor LeadQual into a three-mode engine without breaking the current Indeed flow.",
    context: "Mode 2B is the first paid product slice.",
    constraints: "Keep Indeed scraping intact.\nDo not change deployment.",
    acceptanceCriteria: "Mode selector exists.\nBuild a Lead List has its own form.",
    testPlan: "Run the current Indeed flow.\nOpen the Vercel product link.",
    priority: "high",
  })

  assert.equal(plan.status, "needs_approval")
  assert.equal(plan.executionGate, "Implementation cannot start until this plan is approved.")
  assert.match(plan.executionInstruction, /Return to the CEO only when/)
  assert.match(plan.executionInstruction, /latest Vercel product link/)
})

test("buildWorkOrderPlan makes the custom versus leveraged boundary explicit", () => {
  const plan = buildWorkOrderPlan({
    projectName: "command-center",
    goal: "Add plan-first execution.",
    context: "",
    constraints: "",
    acceptanceCriteria: "",
    testPlan: "",
    priority: "normal",
  })

  assert.equal(plan.customPercent, 35)
  assert.equal(plan.leveragedPercent, 65)
  assert.ok(plan.customWork.some((item) => item.includes("CEO work-order form")))
  assert.ok(plan.leveragedSystems.some((item) => item.includes("Claude Agent SDK")))
  assert.ok(plan.leveragedSystems.some((item) => item.includes("Inngest")))
})

test("buildWorkOrderPlan preserves typed acceptance criteria and test plan in visible plan sections", () => {
  const plan = buildWorkOrderPlan({
    projectName: "leadqual",
    goal: "Refactor LeadQual into a three-mode lead engine without breaking the existing Indeed flow.",
    context:
      "Add three modes: Find AI Prospects, Find My Clients, and Build a Lead List. Build Mode 2B first because it is the $250 product.",
    constraints:
      "Keep existing outreach generation, card UI, copy button, pipeline toggle, and Vercel deployment working.",
    acceptanceCriteria:
      "Mode selector exists\nExisting Indeed flow still works\nBuild a Lead List has city, niche, and result count inputs\nNo implementation starts until the plan is approved",
    testPlan:
      "Run existing Indeed flow\nTest Build a Lead List form\nVerify outreach/card/pipeline/export still work",
    priority: "high",
  })

  assert.deepEqual(plan.acceptanceCriteria, [
    "Mode selector exists",
    "Existing Indeed flow still works",
    "Build a Lead List has city, niche, and result count inputs",
    "No implementation starts until the plan is approved",
  ])
  assert.deepEqual(plan.testPlan, [
    "Run existing Indeed flow",
    "Test Build a Lead List form",
    "Verify outreach/card/pipeline/export still work",
  ])
  assert.ok(plan.requestSummary.some((item) => item.includes("Find AI Prospects")))
  assert.ok(plan.requestSummary.some((item) => item.includes("Build Mode 2B first")))
  assert.ok(plan.doNotBreak.some((item) => item.includes("pipeline toggle")))
})

test("buildWorkOrderPlan creates project-specific worker steps for the LeadQual three-mode request", () => {
  const plan = buildWorkOrderPlan({
    projectName: "leadqual",
    goal: "Refactor LeadQual into a three-mode lead engine without breaking the existing Indeed flow.",
    context:
      "Add three modes: Find AI Prospects, Find My Clients, and Build a Lead List. Build Mode 2B first because it is the $250 product.",
    constraints: "Preserve current Indeed scraping and outreach generation.",
    acceptanceCriteria: "Build a Lead List has city, niche, and result count inputs",
    testPlan: "Existing Indeed flow still works",
    priority: "high",
  })

  const stepText = plan.steps.map((step) => `${step.title} ${step.outcome}`).join("\n")
  assert.match(stepText, /Mode 2B|Build a Lead List/)
  assert.match(stepText, /Indeed/)
  assert.match(plan.executionInstruction, /Build Mode 2B first/)
  assert.match(plan.executionInstruction, /city, niche, and result count inputs/)
  assert.match(plan.executionInstruction, /Preserve current Indeed scraping/)
})
