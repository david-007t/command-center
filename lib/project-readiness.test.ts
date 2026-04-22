import test from "node:test"
import assert from "node:assert/strict"
import { deriveProjectReadiness } from "./project-readiness.ts"

test("deriveProjectReadiness marks a project ready when required operating checks pass", () => {
  const readiness = deriveProjectReadiness({
    repoExists: true,
    governanceFiles: {
      tasks: true,
      handoff: true,
      qa: true,
      security: true,
    },
    hasEnvContract: true,
    hasProductLink: true,
    hasTestCommand: true,
    hasDeployPath: true,
    hasDoNotBreakNotes: true,
  })

  assert.equal(readiness.status, "ready")
  assert.equal(readiness.label, "Ready")
  assert.equal(readiness.tone, "emerald")
})

test("deriveProjectReadiness blocks when the repo or core governance is missing", () => {
  const readiness = deriveProjectReadiness({
    repoExists: true,
    governanceFiles: {
      tasks: false,
      handoff: true,
      qa: true,
      security: true,
    },
    hasEnvContract: true,
    hasProductLink: true,
    hasTestCommand: true,
    hasDeployPath: true,
    hasDoNotBreakNotes: true,
  })

  assert.equal(readiness.status, "blocked")
  assert.match(readiness.summary, /TASKS\.md/)
})

test("deriveProjectReadiness reports missing setup for recoverable gaps", () => {
  const readiness = deriveProjectReadiness({
    repoExists: true,
    governanceFiles: {
      tasks: true,
      handoff: true,
      qa: true,
      security: true,
    },
    hasEnvContract: false,
    hasProductLink: false,
    hasTestCommand: false,
    hasDeployPath: true,
    hasDoNotBreakNotes: true,
  })

  assert.equal(readiness.status, "missing_setup")
  assert.deepEqual(
    readiness.checks.filter((check) => check.status === "missing").map((check) => check.id),
    ["env_contract", "product_link", "test_command"],
  )
})
