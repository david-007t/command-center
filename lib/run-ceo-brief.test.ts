import test from "node:test"
import assert from "node:assert/strict"
import { buildRunCeoBrief } from "./run-ceo-brief.ts"

test("buildRunCeoBrief turns a worker result into a CEO-readable test brief", () => {
  const brief = buildRunCeoBrief(
    {
      projectName: "leadqual",
      status: "completed",
      statusLabel: "Completed",
      summary: "Codex worker completed the requested project task.",
      messagePreview: `All checks pass.

## Outcome
Leadqual backend email handoff is now safer.

## Changes made
| File | Change |
| --- | --- |
| api/send-email.js | Moved SMTP credentials server-side and validated required fields. |
| TASKS.md | Moved the task to Done. |

## Verification
- Ran syntax checks.
- The endpoint currently has no frontend caller.

## Next step
Run vercel dev and execute the AI lead-generation happy path.`,
      executiveMessage: "All checks pass.",
      currentStage: "done",
    },
    {
      projectName: "leadqual",
      productUrl: null,
      productLinks: [
        {
          label: "Production",
          environment: "production",
          url: "https://lead-qualifier-ten.vercel.app",
          state: "READY",
          source: "vercel",
          createdAt: "2026-04-21T20:00:00.000Z",
        },
      ],
      qaChecklist: "Result: FAIL\nRuntime QA evidence missing.",
      securityChecklist: "Result: FAIL\nRemaining localStorage review.",
    },
  )

  assert.equal(brief.status, "Completed")
  assert.equal(brief.productLinks[0]?.href, "https://lead-qualifier-ten.vercel.app")
  assert.equal(brief.productLinks[0]?.label, "Open production")
  assert.match(brief.bottomLine, /backend email-security issue/)
  assert.deepEqual(brief.whatChanged, [
    "The worker hardened the email-sending backend so SMTP credentials stay on the server.",
    "It marked that backend email-security task as done.",
  ])
  assert.deepEqual(brief.whatToTest, [
    "Open the product and run the normal lead-generation flow.",
    "Check that saving, editing, deleting, and refreshing a Ship List company still works.",
  ])
  assert.deepEqual(brief.knownGaps, [
    "The email backend fix may not have a visible button or screen to test yet.",
    "QA is still not signed off because the real product flow has not been tested and recorded.",
    "Security is improved, but the full security checklist is still not complete.",
  ])
})

test("buildRunCeoBrief uses a captured deployment URL when one exists", () => {
  const brief = buildRunCeoBrief(
    {
      projectName: "rbc",
      status: "blocked",
      statusLabel: "Blocked",
      summary: "Worker blocked.",
      messagePreview: "",
      executiveMessage: "Needs credential.",
      currentStage: "blocked",
    },
    {
      projectName: "rbc",
      productUrl: "https://preview.example.com",
    },
  )

  assert.equal(brief.productLinks[0]?.href, "https://preview.example.com")
  assert.equal(brief.productLinks[0]?.label, "Open product")
  assert.deepEqual(brief.knownGaps, ["Needs credential."])
})

test("buildRunCeoBrief explains cancelled runs as having no verified product result", () => {
  const brief = buildRunCeoBrief(
    {
      projectName: "leadqual",
      status: "cancelled",
      statusLabel: "Cancelled",
      summary: "Worker was cancelled by the operator.",
      messagePreview: "Worker was cancelled by the operator.",
      executiveMessage: "Worker was cancelled by the operator.",
      currentStage: "blocked",
    },
    {
      projectName: "leadqual",
      productUrl: "https://lead-qualifier-ten.vercel.app",
    },
  )

  assert.match(brief.bottomLine, /Cancelled before completion/)
  assert.deepEqual(brief.whatChanged, ["No verified product or code change came out of this cancelled run."])
  assert.deepEqual(brief.whatToTest, ["Nothing new needs CEO testing from this cancelled run."])
  assert.deepEqual(brief.knownGaps, ["Continue or retry the approved plan if the fix is still needed."])
})

test("buildRunCeoBrief surfaces the actual CEO decision instead of generic review copy", () => {
  const brief = buildRunCeoBrief(
    {
      projectName: "leadqual",
      status: "awaiting_ceo",
      statusLabel: "Needs your decision",
      summary: "Codex worker completed and surfaced a CEO decision.",
      messagePreview: `All verified. Here is the executive summary.

## Outcome
Fixed the backend email-security issue and pushed commit 27b345a.

## What changed
- Protected the Anthropic and SMTP keys from browser exposure.
- Updated the LeadQual search proxy to return a clear diagnostic when the API key is missing.

## What to test
- Open https://lead-qualifier-ten.vercel.app and search Find AI Prospects for a city and niche.
- Confirm search results appear or the missing-key diagnostic is clear.

## CEO decision needed
Decide whether to sign off after the CEO test scenarios pass, or send this back for a broader security checklist pass.

## Still open
- QA is not signed off until the real product flow is tested and recorded.`,
      executiveMessage: "All verified.",
      currentStage: "done",
    },
    {
      projectName: "leadqual",
      productUrl: "https://lead-qualifier-ten.vercel.app",
    },
  )

  assert.doesNotMatch(brief.bottomLine, /review before you rely on it/i)
  assert.match(brief.bottomLine, /Decide whether to sign off/)
  assert.deepEqual(brief.whatChanged, [
    "Protected the Anthropic and SMTP keys from browser exposure.",
    "Updated the LeadQual search proxy to return a clear diagnostic when the API key is missing.",
  ])
  assert.deepEqual(brief.whatToTest, [
    "Open https://lead-qualifier-ten.vercel.app and search Find AI Prospects for a city and niche.",
    "Confirm search results appear or the missing-key diagnostic is clear.",
  ])
  assert.deepEqual(brief.knownGaps, [
    "Decide whether to sign off after the CEO test scenarios pass, or send this back for a broader security checklist pass.",
    "QA is not signed off until the real product flow is tested and recorded.",
  ])
})

test("buildRunCeoBrief gives awaiting-CEO runs an actionable decision fallback", () => {
  const brief = buildRunCeoBrief(
    {
      projectName: "leadqual",
      status: "awaiting_ceo",
      statusLabel: "Needs your decision",
      summary: "Codex worker completed and surfaced a CEO decision.",
      messagePreview: "",
      executiveMessage: "Codex worker completed and surfaced a CEO decision.",
      currentStage: "done",
    },
    {
      projectName: "leadqual",
      productUrl: "https://lead-qualifier-ten.vercel.app",
    },
  )

  assert.equal(brief.bottomLine, "Decision needed: run the listed test steps, then sign off or send it back with feedback.")
  assert.doesNotMatch(brief.bottomLine, /review before you rely on it/i)
})

test("buildRunCeoBrief can read compact worker summaries with inline section dividers", () => {
  const brief = buildRunCeoBrief(
    {
      projectName: "leadqual",
      status: "awaiting_ceo",
      statusLabel: "Needs your decision",
      summary: "Codex worker completed and surfaced a CEO decision.",
      messagePreview:
        "All verified. --- ## Outcome Fixed lead search diagnostics. --- ## What changed - Returned a clear API-key diagnostic instead of a vague empty result. --- ## What to test - Open https://lead-qualifier-ten.vercel.app and run Find My Clients for Oakland marketing agencies. --- ## CEO decision needed Sign off if the diagnostic and search results look acceptable. --- ## Still open - QA still needs your real-flow test.",
      executiveMessage: "All verified.",
      currentStage: "done",
    },
    {
      projectName: "leadqual",
      productUrl: "https://lead-qualifier-ten.vercel.app",
    },
  )

  assert.equal(brief.bottomLine, "Sign off if the diagnostic and search results look acceptable.")
  assert.deepEqual(brief.whatChanged, ["Returned a clear API-key diagnostic instead of a vague empty result."])
  assert.deepEqual(brief.whatToTest, ["Open https://lead-qualifier-ten.vercel.app and run Find My Clients for Oakland marketing agencies."])
  assert.deepEqual(brief.knownGaps, [
    "Sign off if the diagnostic and search results look acceptable.",
    "QA still needs your real-flow test.",
  ])
})
