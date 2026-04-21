const test = require("node:test")
const assert = require("node:assert/strict")
const { classifyOutcome, hasRequiredOutcomeSummary } = require("./worker-contracts.js")

test("hasRequiredOutcomeSummary requires outcome and verification sections", () => {
  assert.equal(hasRequiredOutcomeSummary("Outcome\nFixed it.\n\nVerification\nChecked it."), true)
  assert.equal(hasRequiredOutcomeSummary("Fixed it."), false)
})

test("classifyOutcome returns blocked_on_config for missing vercel token investigations", () => {
  const outcome = classifyOutcome(
    { type: "project_task", status: "completed", runTemplate: "investigate_issue", initialGitHead: "abc" },
    "Outcome\nBlocked on token.\n\nVerification\nConfirmed missing credential.",
    { diagnosisCode: "missing_vercel_token", nextStep: "Add Vercel API access." },
    "abc",
  )

  assert.equal(outcome.jobStatus, "blocked_on_config")
  assert.match(outcome.summary, /blocked on configuration/i)
})

test("classifyOutcome rejects fix_issue runs without a new commit", () => {
  const outcome = classifyOutcome(
    { type: "project_task", status: "completed", runTemplate: "fix_issue", initialGitHead: "abc123" },
    "Outcome\nMade the fix.\n\nVerification\nConfirmed the page loads.",
    null,
    "abc123",
  )

  assert.equal(outcome.jobStatus, "blocked")
  assert.match(outcome.summary, /without a new git commit/i)
})

test("classifyOutcome rejects fix_issue runs without file changes", () => {
  const outcome = classifyOutcome(
    { type: "project_task", status: "completed", runTemplate: "fix_issue", initialGitHead: "abc123" },
    "Outcome\nMade the fix.\n\nVerification\nConfirmed the page loads.",
    null,
    "def456",
    [],
  )

  assert.equal(outcome.jobStatus, "blocked")
  assert.match(outcome.summary, /without any file changes/i)
})

test("classifyOutcome surfaces Codex usage-limit failures explicitly", () => {
  const outcome = classifyOutcome(
    { type: "project_task", status: "failed", runTemplate: "fix_issue", initialGitHead: "abc123" },
    "",
    null,
    "abc123",
    [],
    "ERROR: You've hit your usage limit. Upgrade to Pro or purchase more credits.",
  )

  assert.equal(outcome.jobStatus, "blocked")
  assert.match(outcome.summary, /usage limit/i)
})

test("classifyOutcome preserves successful outcomes when usage-limit text is only noisy log output", () => {
  const outcome = classifyOutcome(
    { type: "project_task", status: "completed", runTemplate: "continue_project", initialGitHead: "abc123" },
    "Outcome\nVerified the task is already complete.\n\nVerification\nnpm run build passed.",
    null,
    "abc123",
    [],
    "warning: prior shell reported usage limit before this successful run finished",
  )

  assert.equal(outcome.jobStatus, "completed")
  assert.match(outcome.summary, /completed the requested project task/i)
})

test("classifyOutcome preserves successful outcomes when auth text is only noisy log output", () => {
  const outcome = classifyOutcome(
    { type: "project_task", status: "completed", runTemplate: "continue_project", initialGitHead: "abc123" },
    "Outcome\nCompleted the scoped task.\n\nVerification\nTests passed.",
    null,
    "abc123",
    [],
    "warning: 401 unauthorized from a non-blocking background probe after the successful run",
  )

  assert.equal(outcome.jobStatus, "completed")
  assert.match(outcome.summary, /completed the requested project task/i)
})

test("classifyOutcome does not fail successful runs just because they mention a project blocker", () => {
  const outcome = classifyOutcome(
    { type: "project_task", status: "completed", runTemplate: "continue_project", initialGitHead: "abc123" },
    "Outcome\nCompleted the scoped task and updated governance.\n\nVerification\nBuild passed.\n\nNext step\nThe project remains blocked on a separate external dependency.",
    null,
    "abc123",
    [],
    "",
  )

  assert.equal(outcome.jobStatus, "completed")
  assert.match(outcome.summary, /completed the requested project task/i)
})
