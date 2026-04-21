type InvestigationAction = {
  kind: string
  summary: string
}

type InvestigationLike = {
  title: string
  diagnosisCode?: string
  suggestedInstruction?: string
  recommendedAction?: InvestigationAction
} | null

export function buildProjectQuickActions(projectName: string, investigation: InvestigationLike) {
  if (!investigation) {
    return [
      `What does ${projectName} need right now?`,
      `Status update`,
      `What is the current decision in ${projectName}?`,
      `Why is it queued?`,
      `Proceed`,
    ]
  }

  return [
    `What does ${projectName} need right now?`,
    `Status update`,
    `What is the current decision in ${projectName}?`,
    `Why is it queued?`,
    `Proceed`,
  ]
}
