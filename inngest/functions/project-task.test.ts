import test from "node:test"
import assert from "node:assert/strict"

import { buildProjectTaskPrompt } from "./project-task-prompt.ts"

test("buildProjectTaskPrompt includes fix_issue execution and commit guardrails", () => {
  const prompt = buildProjectTaskPrompt({
    projectName: "leadqual",
    runTemplate: "fix_issue",
    instruction: "Fix the verified API auth regression.",
    governanceTargets: ["TASKS.md", "ERRORS.md", "HANDOFF.md"],
    successCriteria: [
      "The fix is implemented.",
      "The fix is verified.",
      "The result is committed.",
    ],
  })

  assert.match(prompt, /Run type: fix_issue\./)
  assert.match(prompt, /You must write code changes and create a git commit before finishing\./)
  assert.match(prompt, /If no code changes were required, explain that explicitly and stop in a blocked state/i)
  assert.match(prompt, /Governance files expected to be updated if state changes: TASKS\.md, ERRORS\.md, HANDOFF\.md\./)
})

test("buildProjectTaskPrompt preserves the existing generic project-task contract", () => {
  const prompt = buildProjectTaskPrompt({
    projectName: "pulse",
    runTemplate: "review_next_move",
    instruction: "Review the next move.",
    governanceTargets: ["TASKS.md", "HANDOFF.md"],
    successCriteria: ["Identify the best next step."],
  })

  assert.match(prompt, /You are executing a project task inside pulse\./)
  assert.match(prompt, /Run type: review_next_move\./)
  assert.match(prompt, /End with these exact sections: Outcome, Verification, Governance updates, Next step\./)
  assert.doesNotMatch(prompt, /git commit before finishing/i)
})
