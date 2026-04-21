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
}

export function shouldSuppressRuntimeNotification(
  currentPath: string,
  notification: Pick<RuntimeNotification, "projectName" | "eventType" | "reason">,
) {
  const match = currentPath.match(/^\/projects\/([^/]+)\/chat(?:\/|$)/)
  if (!match) return false

  const activeProject = decodeURIComponent(match[1] ?? "")
  if (!activeProject) return false

  // Project chat is already the live activity surface, so suppress all global toasts there.
  if (!notification.projectName) {
    return true
  }

  if (activeProject.toLowerCase() !== notification.projectName.toLowerCase()) {
    return false
  }

  return true
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
  }
}

export function mergeRuntimeNotifications(queue: RuntimeNotification[], next: RuntimeNotification) {
  const withoutDuplicate = queue.filter((item) => item.id !== next.id)
  return [next, ...withoutDuplicate].slice(0, 5)
}
