import test from "node:test"
import assert from "node:assert/strict"
import { buildProjectApprovalMessage } from "./project-chat-approval.ts"

test("buildProjectApprovalMessage uses diagnosis-aware language for investigation runs", () => {
  const message = buildProjectApprovalMessage({
    projectName: "anelo",
    runTemplate: "investigate_issue",
    autonomyMode: "can_autofix",
    investigation: {
      diagnosisCode: "missing_stage_preview_deployment",
      recommendedAction: {
        kind: "trigger_stage_deployment",
        summary: "Use the narrowest safe trigger to force a stage deployment only after GitHub is confirmed.",
      },
    },
  })

  assert.match(message, /missing_stage_preview_deployment/i)
  assert.match(message, /trigger_stage_deployment/i)
  assert.match(message, /Reply with approve/i)
})

test("buildProjectApprovalMessage keeps strong safety wording for CEO-reviewed investigations", () => {
  const message = buildProjectApprovalMessage({
    projectName: "anelo",
    runTemplate: "investigate_issue",
    autonomyMode: "needs_ceo_approval",
    investigation: {
      diagnosisCode: "vercel_api_blocked",
      recommendedAction: {
        kind: "inspect_vercel_api_access",
        summary: "Inspect Vercel API access before trying remediation.",
      },
    },
  })

  assert.match(message, /needs CEO review first/i)
  assert.match(message, /inspect_vercel_api_access/i)
})
