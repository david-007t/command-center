export type RuntimeMutationReason = "launch" | "decision" | "job_update" | "portfolio_update" | "refresh"

export type RuntimeMutationEvent = {
  projectName?: string | null
  scope: "project" | "portfolio" | "system"
  reason: RuntimeMutationReason
  timestamp: number
  eventType?: string
  title?: string
  body?: string | null
  chatThreadId?: string | null
  jobId?: string | null
  status?: string | null
  currentStage?: string | null
}

export type StoredRuntimeEventRow = {
  event_type: string
  title: string
  body: string | null
  visibility_scope: string
  created_at: string
  payload?: {
    projectName?: string | null
    chatThreadId?: string | null
    jobId?: string | null
    status?: string | null
    currentStage?: string | null
    reason?: RuntimeMutationReason
  } | null
}

export function reasonFromEventType(eventType: string): RuntimeMutationReason {
  if (eventType.startsWith("decision_")) return "decision"
  if (eventType === "run_launched") return "launch"
  if (eventType === "project_runtime_updated") return "refresh"
  if (eventType === "message_created") return "refresh"
  return "job_update"
}

export function mapStoredEventToRuntimeMutation(row: StoredRuntimeEventRow): RuntimeMutationEvent {
  const scope = row.visibility_scope === "system" ? "system" : row.visibility_scope === "portfolio" ? "portfolio" : "project"
  return {
    projectName: row.payload?.projectName ?? null,
    scope,
    reason: row.payload?.reason ?? reasonFromEventType(row.event_type),
    timestamp: new Date(row.created_at).getTime(),
    eventType: row.event_type,
    title: row.title,
    body: row.body,
    chatThreadId: row.payload?.chatThreadId ?? null,
    jobId: row.payload?.jobId ?? null,
    status: row.payload?.status ?? null,
    currentStage: row.payload?.currentStage ?? null,
  }
}

export function formatRuntimeNotice(event: RuntimeMutationEvent) {
  if (!event.projectName) {
    return event.title ?? "Live update received."
  }

  return `${event.projectName}: ${event.title ?? "Live update received."}`
}
