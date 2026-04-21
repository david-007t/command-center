import test from "node:test"
import assert from "node:assert/strict"
import { buildProjectInvestigationBrief, buildProjectInvestigationOpeningMessage } from "./project-chat-investigation.ts"

test("buildProjectInvestigationBrief includes diagnosis, proof, remediation, and deployment snapshot", () => {
  const brief = buildProjectInvestigationBrief({
    title: "Investigate missing stage preview",
    summary: "The branch exists upstream, but Vercel still has no matching stage preview deployment.",
    likelyCause: "GitHub has the stage branch, but Vercel has not surfaced a matching preview deployment yet.",
    nextStep: "Inspect Vercel deployment state for stage and consider a narrow trigger only after GitHub is confirmed.",
    diagnosisCode: "missing_stage_preview_deployment",
    recommendedAction: {
      kind: "trigger_stage_deployment",
      summary: "Use the narrowest safe trigger to force a stage deployment only after GitHub is confirmed.",
    },
    proofSummary: {
      verified: ["GitHub shows the stage branch upstream."],
      inferred: ["Vercel has not surfaced a matching preview deployment yet."],
      blocked: [],
    },
    deploymentDetails: {
      branch: "stage",
      state: "BUILDING",
      commitSha: "abc1234",
      url: "https://anelo-stage.vercel.app",
      createdAt: "2026-04-15T18:00:00.000Z",
    },
  })

  assert.match(brief, /Diagnosis: missing_stage_preview_deployment/i)
  assert.match(brief, /Recommended remediation: trigger_stage_deployment/i)
  assert.match(brief, /Verified proof:/i)
  assert.match(brief, /Inferred:/i)
  assert.match(brief, /Latest deployment snapshot:/i)
  assert.match(brief, /BUILDING/i)
})

test("buildProjectInvestigationOpeningMessage turns investigation state into an operator-style opener", () => {
  const message = buildProjectInvestigationOpeningMessage("anelo", {
    title: "Investigate missing stage preview",
    summary: "The branch exists upstream, but Vercel still has no matching stage preview deployment.",
    likelyCause: "GitHub has the stage branch, but Vercel has not surfaced a matching preview deployment yet.",
    nextStep: "Inspect Vercel deployment state for stage and consider a narrow trigger only after GitHub is confirmed.",
    recommendedAction: {
      kind: "trigger_stage_deployment",
      summary: "Use the narrowest safe trigger to force a stage deployment only after GitHub is confirmed.",
    },
    proofSummary: {
      verified: ["GitHub shows the stage branch upstream."],
      inferred: ["Vercel has not surfaced a matching preview deployment yet."],
      blocked: [],
    },
    deploymentDetails: {
      branch: "stage",
      state: "BUILDING",
      commitSha: "abc1234",
      url: "https://anelo-stage.vercel.app",
      createdAt: "2026-04-15T18:00:00.000Z",
    },
  })

  assert.match(message, /anelo loaded with an active investigation/i)
  assert.match(message, /What I checked/i)
  assert.match(message, /What I found/i)
  assert.match(message, /trigger_stage_deployment/i)
  assert.match(message, /Latest deployment snapshot/i)
})
