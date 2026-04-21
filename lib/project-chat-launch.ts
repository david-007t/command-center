import type { ProjectRunTemplate } from "@/lib/orchestration"

type InvestigationLike = {
  suggestedTemplate?: ProjectRunTemplate
  suggestedInstruction?: string
} | null

type RecommendedActionLike = {
  template: ProjectRunTemplate
} | null

const SIMPLE_APPROVAL = /^(approve|approved|yes|yes do it|yes do that|go ahead|proceed|ship it|ok proceed|okay proceed|continue)\.?$/i

export function getImplicitProjectLaunch(
  userMessage: string,
  {
    investigation,
    recommendedAction,
  }: {
    investigation: InvestigationLike
    recommendedAction: RecommendedActionLike
  },
) {
  if (!SIMPLE_APPROVAL.test(userMessage.trim())) return null

  if (investigation?.suggestedInstruction && investigation?.suggestedTemplate) {
    return {
      template: investigation.suggestedTemplate,
      instruction: investigation.suggestedInstruction,
      source: "investigation" as const,
    }
  }

  if (!recommendedAction?.template) return null

  return {
    template: recommendedAction.template,
    instruction: undefined,
    source: "recommended_action" as const,
  }
}
