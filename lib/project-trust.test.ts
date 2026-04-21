import test from "node:test"
import assert from "node:assert/strict"
import { summarizeTrustChecks, type TrustCheck } from "./project-trust.ts"

test("summarizeTrustChecks marks state unverified when any critical proof is missing", () => {
  const checks: TrustCheck[] = [
    {
      label: "Git branch wiring",
      status: "confirmed",
      source: "local_repo",
      detail: "Local repo is on stage and tracks origin/stage.",
    },
    {
      label: "Stage preview deployment",
      status: "unverified",
      source: "external_deploy",
      detail: "No stage preview deployment has been observed yet.",
    },
  ]

  const trust = summarizeTrustChecks(checks)

  assert.equal(trust.level, "unverified")
  assert.match(trust.headline, /not yet verified/i)
})

test("summarizeTrustChecks marks state confirmed when all checks are confirmed", () => {
  const checks: TrustCheck[] = [
    {
      label: "Git branch wiring",
      status: "confirmed",
      source: "local_repo",
      detail: "Local repo is on stage and tracks origin/stage.",
    },
    {
      label: "Governance refresh",
      status: "confirmed",
      source: "governance",
      detail: "Expected governance files were updated during the run.",
    },
  ]

  const trust = summarizeTrustChecks(checks)

  assert.equal(trust.level, "confirmed")
  assert.match(trust.headline, /backed by verified evidence/i)
})
