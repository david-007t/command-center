type RuntimeMutationEvent = {
  projectName?: string | null
  scope: "project" | "portfolio" | "system"
  reason: "launch" | "decision" | "job_update" | "portfolio_update" | "refresh"
  timestamp: number
  eventType?: string
  title?: string
  body?: string | null
  chatThreadId?: string | null
  jobId?: string | null
  status?: string | null
  currentStage?: string | null
}

export type RuntimeNotification = {
  id: string
  projectName: string | null
  jobId: string | null
  title: string
  message: string
  timestamp: number
  eventType: string | null
  reason: RuntimeMutationEvent["reason"] | null
  chatThreadId: string | null
  status: string | null
  currentStage: string | null
}

const actionableStatuses = new Set(["completed", "failed", "blocked", "timed_out", "cancelled", "awaiting_ceo", "blocked_on_config"])

export function isActionableRuntimeNotification(notification: Pick<RuntimeNotification, "eventType" | "reason" | "status">) {
  if (notification.status && actionableStatuses.has(notification.status)) {
    return true
  }

  if (notification.eventType === "run_launched" || notification.eventType === "run_stage_changed" || notification.eventType === "message_created") {
    return false
  }

  return notification.reason === "decision"
}

export function shouldSuppressRuntimeNotification(
  currentPath: string,
  notification: Pick<RuntimeNotification, "projectName" | "eventType" | "reason" | "status">,
) {
  if (!isActionableRuntimeNotification(notification)) {
    return true
  }

  if (currentPath.match(/^\/projects\/[^/]+(?:\/|$)/)) {
    // Project pages already show assignment progress and the run log inline.
    return true
  }

  return false
}

function formatRuntimeNotice(event: RuntimeMutationEvent) {
  if (!event.projectName) {
    return event.title ?? "Live update received."
  }

  return `${event.projectName}: ${event.title ?? "Live update received."}`
}

export function buildRuntimeNotification(event: RuntimeMutationEvent): RuntimeNotification {
  return {
    id: `${event.jobId ?? "system"}:${event.eventType ?? "runtime"}:${event.status ?? "unknown"}:${event.currentStage ?? "none"}`,
    projectName: event.projectName ?? null,
    jobId: event.jobId ?? null,
    title: event.title ?? formatRuntimeNotice(event),
    message: event.body?.trim() || formatRuntimeNotice(event),
    timestamp: event.timestamp,
    eventType: event.eventType ?? null,
    reason: event.reason ?? null,
    chatThreadId: event.chatThreadId ?? null,
    status: event.status ?? null,
    currentStage: event.currentStage ?? null,
  }
}

export function mergeRuntimeNotifications(queue: RuntimeNotification[], next: RuntimeNotification) {
  const withoutDuplicate = queue.filter((item) => item.id !== next.id)
  return [next, ...withoutDuplicate].slice(0, 5)
}
