import test from "node:test"
import assert from "node:assert/strict"
import { deriveCompactionHealth, deriveInvestigationAutonomy, deriveUsageGuardrails } from "./command-center-guardrails.ts"

test("deriveUsageGuardrails escalates to critical when weekly cost and tokens are high", () => {
  const summary = deriveUsageGuardrails({
    weeklyTokens: 620_000,
    weeklyCostUsd: 28,
    monthlyCostUsd: 115,
  })

  assert.equal(summary.overallStatus, "critical")
  assert.match(summary.headline, /high enough/i)
})

test("deriveInvestigationAutonomy requires CEO approval when autofix is unsafe", () => {
  const autonomy = deriveInvestigationAutonomy({
    canAutofix: false,
    contextHealth: "healthy",
    usageStatus: "healthy",
  })

  assert.equal(autonomy.mode, "needs_ceo_approval")
})

test("deriveCompactionHealth marks large packs as overloaded", () => {
  const compaction = deriveCompactionHealth(2501)

  assert.equal(compaction.health, "overloaded")
  assert.match(compaction.recommendedAction, /compact recent history/i)
})
