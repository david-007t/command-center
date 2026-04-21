import { COMMAND_CENTER_PROJECT, MANAGED_PROJECTS } from "./managed-projects"
import type { FeedbackCategory, FeedbackScope, FeedbackSeverity } from "./feedback"

export type DirectFeedbackIntake = {
  scope: FeedbackScope
  projectName: string | null
  category: FeedbackCategory
  severity: FeedbackSeverity
  summary: string
  desiredOutcome: string
  shouldLaunch: boolean
}

function cleanClause(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/[. ]+$/, "")
}

function inferCategory(summary: string, desiredOutcome: string): FeedbackCategory {
  const combined = `${summary} ${desiredOutcome}`.toLowerCase()
  if (/\b(decide|decision|choose|which option|tradeoff|approval)\b/.test(combined)) {
    return "needs_decision"
  }
  if (/\b(governance|stale|status|handoff|tasks\.md|errors\.md|reconcile)\b/.test(combined)) {
    return "governance_fix"
  }
  if (/\b(improve|improvement|better|clearer|surface|show|ux|experience|visibility)\b/.test(combined)) {
    return "product_improvement"
  }
  return "self_heal"
}

function inferSeverity(summary: string, desiredOutcome: string): FeedbackSeverity {
  const combined = `${summary} ${desiredOutcome}`.toLowerCase()
  if (/\b(blocker|broken|failing|fails|not working|urgent|incident)\b/.test(combined)) {
    return "high"
  }
  if (/\b(minor|small|polish|nice to have)\b/.test(combined)) {
    return "low"
  }
  return "medium"
}

function inferScope(message: string): { scope: FeedbackScope; projectName: string | null } | null {
  const normalized = message.toLowerCase()
  if (/\bsystem feedback\b/.test(normalized) || /\bcommand center\b/.test(normalized) || /\bcommand-center\b/.test(normalized)) {
    return { scope: "system", projectName: COMMAND_CENTER_PROJECT }
  }

  for (const projectName of MANAGED_PROJECTS) {
    const projectPattern = new RegExp(`\\b${projectName}\\b`, "i")
    if (projectPattern.test(message) && /\bfeedback\b/i.test(message)) {
      return { scope: "project", projectName }
    }
  }

  return null
}

export function parseDirectFeedbackIntake(message: string): DirectFeedbackIntake | null {
  const desiredOutcomeMatch = message.match(/\bdesired outcome:\s*([\s\S]+)$/i)
  if (!desiredOutcomeMatch) return null

  const scopeInfo = inferScope(message)
  if (!scopeInfo) return null

  const prefix = message.slice(0, desiredOutcomeMatch.index ?? message.length)
  const summary = cleanClause(
    prefix
      .replace(/^system\s+feedback\s+for\s+command(?:\s+|-)center\s*:\s*/i, "")
      .replace(/^system\s+feedback\s*:\s*/i, "")
      .replace(/^project\s+feedback\s+for\s+[a-z0-9_-]+\s*:\s*/i, "")
      .replace(/^feedback\s+for\s+command(?:\s+|-)center\s*:\s*/i, "")
      .replace(/^[:\s-]+/, ""),
  )
  const desiredOutcome = cleanClause(desiredOutcomeMatch[1] ?? "")

  if (!summary || !desiredOutcome) return null

  const category = inferCategory(summary, desiredOutcome)
  return {
    scope: scopeInfo.scope,
    projectName: scopeInfo.projectName,
    category,
    severity: inferSeverity(summary, desiredOutcome),
    summary,
    desiredOutcome,
    shouldLaunch: category !== "needs_decision",
  }
}
