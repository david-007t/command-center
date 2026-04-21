type RunTemplate = "custom" | "continue_project" | "fix_blocker" | "fix_issue" | "review_next_move" | "prep_qa" | "investigate_issue"

type InvestigationLike = {
  diagnosisCode?: string
  recommendedAction?: {
    kind: string
    summary: string
  }
} | null

export function buildProjectApprovalMessage(input: {
  projectName: string
  runTemplate: RunTemplate
  autonomyMode?: "can_autofix" | "needs_review" | "needs_ceo_approval" | null
  investigation?: InvestigationLike
}) {
  const labels: Record<RunTemplate, string> = {
    continue_project: "continue the project",
    fix_blocker: "address the main blocker",
    fix_issue: "fix the confirmed issue",
    review_next_move: "review the recommended next move",
    prep_qa: "prepare the project for QA",
    custom: "run the requested project task",
    investigate_issue: "run the investigation",
  }

  if (input.runTemplate === "investigate_issue" && input.investigation) {
    const diagnosis = input.investigation.diagnosisCode ? `Diagnosis: ${input.investigation.diagnosisCode}. ` : ""
    const remediation = input.investigation.recommendedAction
      ? `Recommended remediation: ${input.investigation.recommendedAction.kind} - ${input.investigation.recommendedAction.summary} `
      : ""

    if (input.autonomyMode === "needs_ceo_approval") {
      return `Approval needed before ${input.projectName} can run this investigation because the current safety policy says it needs CEO review first. ${diagnosis}${remediation}Reply with approve if you want me to proceed anyway.`
    }

    return `Approval needed to investigate ${input.projectName}. ${diagnosis}${remediation}Reply with approve if you want me to proceed.`
  }

  return `Approval needed to ${labels[input.runTemplate] ?? "run the requested project task"} for ${input.projectName}. Reply with approve if you want me to proceed.`
}
