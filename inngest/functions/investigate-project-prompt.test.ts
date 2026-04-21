import test from "node:test"
import assert from "node:assert/strict"

import { buildInvestigateProjectPrompt } from "./investigate-project-prompt.ts"

test("buildInvestigateProjectPrompt includes evidence-first investigation guidance", () => {
  const prompt = buildInvestigateProjectPrompt({
    projectName: "anelo",
    instruction: "Investigate the missing preview deployment.",
    governanceTargets: ["TASKS.md", "ERRORS.md", "HANDOFF.md"],
    successCriteria: ["Diagnose the root cause.", "Verify the diagnosis."],
    investigationArtifactPath: "supabase://runs/run-123/evidence",
    investigation: {
      projectName: "anelo",
      generatedAt: "2026-04-16T00:00:00.000Z",
      status: "needs_attention",
      title: "Investigate missing stage preview",
      summary: "Preview state is missing.",
      likelyCause: "Project link is missing.",
      nextStep: "Restore the link and re-check deployment evidence.",
      canAutofix: true,
      suggestedInstruction: "Investigate the missing preview.",
      checks: [],
      evidence: [{ label: "Vercel link", status: "unverified", source: "vercel", detail: "No link." }],
      actions: [{ kind: "link_vercel_project", status: "pending", summary: "Restore the project link." }],
      trustChecks: [],
    },
  })

  assert.match(prompt, /Run type: investigate_issue\./)
  assert.match(prompt, /Structured investigation evidence has already been captured/)
  assert.match(prompt, /Investigation artifact: supabase:\/\/runs\/run-123\/evidence/)
  assert.match(prompt, /Use that evidence as your starting point\./)
})
