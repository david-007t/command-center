import type { FeedbackCategory, FeedbackScope, FeedbackStatus } from "./feedback"

type FeedbackAcknowledgmentInput = {
  status: FeedbackStatus
  scope: FeedbackScope
  category: FeedbackCategory
  summary: string
  jobId?: string
  jobType?: "system_task" | "project_task" | "orchestrator_run"
}

function scopeLabel(scope: FeedbackScope) {
  return scope === "system" ? "Command Center" : "the project"
}

function launchLabel(jobType?: FeedbackAcknowledgmentInput["jobType"]) {
  if (jobType === "system_task") return "system task"
  if (jobType === "project_task") return "project task"
  if (jobType === "orchestrator_run") return "orchestrator run"
  return "worker"
}

export function buildFeedbackAcknowledgment(input: FeedbackAcknowledgmentInput) {
  const summary = input.summary.trim()
  const intro = [
    "Feedback captured.",
    `Logged as tracked system input for ${scopeLabel(input.scope)}.`,
    `Recorded issue: ${summary}`,
  ]

  if (input.status === "actioning" && input.jobId) {
    return `${intro.join(" ")} Next step: Auto-launch started: ${launchLabel(input.jobType)} ${input.jobId} is now working this feedback.`
  }

  if (input.status === "needs_decision") {
    return `${intro.join(" ")} Next step: held for CEO decision before any worker is launched.`
  }

  return `${intro.join(" ")} Next step: queued for review in the operating system. No worker launched yet.`
}

export type { FeedbackAcknowledgmentInput }
