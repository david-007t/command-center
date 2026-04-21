import type { FeedbackRecord } from "./feedback"
import type { ProjectStatus } from "./project-status"

const COMMAND_CENTER_PROJECT = "command-center"

export type ScoutPriority = "critical" | "important" | "watch"
export type ScoutRecommendation = {
  id: string
  projectName: string | null
  priority: ScoutPriority
  confidence: "confirmed" | "inferred" | "unverified"
  title: string
  summary: string
  rationale: string
  action: string
}

export type DailyScoutBrief = {
  generatedAt: string
  headline: string
  recommendations: ScoutRecommendation[]
  watchlist: string[]
}

function priorityWeight(priority: ScoutPriority) {
  if (priority === "critical") return 0
  if (priority === "important") return 1
  return 2
}

export function buildDailyScoutBrief(input: {
  projects: ProjectStatus[]
  feedback: FeedbackRecord[]
  usageStatus?: string | null
}) {
  const recommendations: ScoutRecommendation[] = []

  for (const project of input.projects) {
    if (project.ceoDecision) {
      recommendations.push({
        id: `${project.name}-decision`,
        projectName: project.name,
        priority: project.ceoDecision.priority === "critical" ? "critical" : "important",
        confidence: "confirmed",
        title: `${project.name} needs a decision`,
        summary: project.ceoDecision.reason,
        rationale: project.ceoDecision.recommendation,
        action: `Review ${project.name} in project chat or the project overview before launching more work.`,
      })
      continue
    }

    if (project.investigation && project.investigation.status !== "healthy") {
      recommendations.push({
        id: `${project.name}-investigation`,
        projectName: project.name,
        priority: project.investigation.status === "blocked" ? "critical" : "important",
        confidence: project.runtimeState?.trust.level === "confirmed" ? "confirmed" : project.runtimeState?.trust.level === "inferred" ? "inferred" : "unverified",
        title: project.investigation.title,
        summary: project.investigation.summary,
        rationale: project.investigation.likelyCause,
        action: project.investigation.nextStep,
      })
      continue
    }

    if (project.runtimeState?.trust.level && project.runtimeState.trust.level !== "confirmed") {
      recommendations.push({
        id: `${project.name}-trust`,
        projectName: project.name,
        priority: "watch",
        confidence: project.runtimeState.trust.level,
        title: `${project.name} still has a trust gap`,
        summary: project.runtimeState.trust.headline,
        rationale: project.blocker,
        action: project.recommendedAction.reason,
      })
    }
  }

  const openSystemFeedback = input.feedback.find(
    (record) =>
      (record.scope === "system" || record.projectName === COMMAND_CENTER_PROJECT) &&
      (record.status === "logged" || record.status === "actioning" || record.status === "needs_decision"),
  )
  if (openSystemFeedback) {
    recommendations.push({
      id: "command-center-improvement",
      projectName: COMMAND_CENTER_PROJECT,
      priority: openSystemFeedback.status === "needs_decision" ? "critical" : "important",
      confidence: "confirmed",
      title: "Command Center should improve itself next",
      summary: openSystemFeedback.summary,
      rationale: openSystemFeedback.desiredOutcome,
      action:
        openSystemFeedback.status === "actioning"
          ? "Let the current self-heal run finish, then review the verified outcome."
          : "Use project chat or the project work view to approve the narrowest self-heal step.",
    })
  }

  if (input.usageStatus && input.usageStatus !== "healthy") {
    recommendations.push({
      id: "usage-guardrail",
      projectName: null,
      priority: input.usageStatus === "critical" ? "critical" : "watch",
      confidence: "confirmed",
      title: "Runtime usage guardrails need attention",
      summary: `Current usage state is ${input.usageStatus}.`,
      rationale: "Scout should keep recommendations narrower when usage pressure is elevated.",
      action: "Prefer project-native chat, compact context, and the smallest useful follow-up runs.",
    })
  }

  const sorted = recommendations.sort((left, right) => priorityWeight(left.priority) - priorityWeight(right.priority))
  const watchlist = input.projects
    .filter((project) => !sorted.some((item) => item.projectName === project.name))
    .slice(0, 4)
    .map((project) => `${project.name}: ${project.nextAction}`)

  const headline =
    sorted[0]?.title ??
    "Scout sees a stable operating picture right now."

  return {
    generatedAt: new Date().toISOString(),
    headline,
    recommendations: sorted.slice(0, 6),
    watchlist,
  } satisfies DailyScoutBrief
}
