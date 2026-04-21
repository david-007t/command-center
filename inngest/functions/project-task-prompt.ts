type SupportedProjectTaskTemplate = "custom" | "fix_blocker" | "fix_issue" | "review_next_move" | "prep_qa"

export function buildProjectTaskPrompt(input: {
  projectName: string
  runTemplate: SupportedProjectTaskTemplate
  instruction: string
  governanceTargets: string[]
  successCriteria: string[]
}) {
  return [
    `You are executing a project task inside ${input.projectName}.`,
    `Run type: ${input.runTemplate}.`,
    "Read CLAUDE.md, TASKS.md, HANDOFF.md, and ERRORS.md before acting.",
    "Follow the project governance files exactly.",
    `Governance files expected to be updated if state changes: ${input.governanceTargets.join(", ") || "TASKS.md, HANDOFF.md"}.`,
    `User instruction: ${input.instruction}`,
    "Success criteria:",
    ...input.successCriteria.map((item, index) => `${index + 1}. ${item}`),
    "Session rules:",
    "1. Update every required governance target if the project state changed.",
    "2. If you cannot safely continue, mark the outcome as blocked in TASKS.md and explain why in HANDOFF.md.",
    "3. If the outcome requires a business or product decision, state CEO DECISION NEEDED explicitly in the final message and in HANDOFF.md.",
    "4. End with these exact sections: Outcome, Verification, Governance updates, Next step.",
    ...(input.runTemplate === "fix_issue"
      ? [
          "5. This is a fix run. You must write code changes and create a git commit before finishing.",
          "6. If no code changes were required, explain that explicitly and stop in a blocked state instead of claiming success.",
        ]
      : []),
    "Return a concise summary with what you changed, what you verified, and any blockers.",
  ].join("\n")
}
