import type { InvestigationRecord } from "@/lib/project-investigation"

function summarizeInvestigationContext(record: InvestigationRecord | null) {
  if (!record) return "No structured investigation evidence was captured."

  return [
    `Investigation status: ${record.status}.`,
    `Summary: ${record.summary}`,
    "Evidence found:",
    ...record.evidence.slice(0, 6).map((item) => `- ${item.label}: ${item.detail}`),
    ...(record.actions.length ? ["Remediation actions:", ...record.actions.map((item) => `- ${item.kind}: ${item.summary}`)] : []),
    `Likely cause: ${record.likelyCause}`,
    `Exact next fix: ${record.nextStep}`,
  ].join("\n")
}

export function buildInvestigateProjectPrompt(input: {
  projectName: string
  instruction: string
  governanceTargets: string[]
  successCriteria: string[]
  investigation: InvestigationRecord | null
  investigationArtifactPath?: string | null
}) {
  return [
    `You are executing a project task inside ${input.projectName}.`,
    "Run type: investigate_issue.",
    "Read CLAUDE.md, TASKS.md, HANDOFF.md, and ERRORS.md before acting.",
    "Follow the project governance files exactly.",
    `Governance files expected to be updated if state changes: ${input.governanceTargets.join(", ") || "TASKS.md, HANDOFF.md"}.`,
    `User instruction: ${input.instruction}`,
    "Success criteria:",
    ...input.successCriteria.map((item, index) => `${index + 1}. ${item}`),
    "Structured investigation evidence has already been captured for this run.",
    `Investigation artifact: ${input.investigationArtifactPath ?? "not available"}`,
    summarizeInvestigationContext(input.investigation),
    "Use that evidence as your starting point. Do not repeat generic advisory work if the artifact already answers it.",
    "Session rules:",
    "1. Update every required governance target if the project state changed.",
    "2. If you cannot safely continue, mark the outcome as blocked in TASKS.md and explain why in HANDOFF.md.",
    "3. If the outcome requires a business or product decision, state CEO DECISION NEEDED explicitly in the final message and in HANDOFF.md.",
    "4. End with these exact sections: Outcome, Verification, Governance updates, Next step.",
    "5. Keep the work evidence-first. Prefer concrete remediation or verified diagnosis over broad speculation.",
    "Return a concise summary with what you changed, what you verified, and any blockers.",
  ].join("\n")
}
