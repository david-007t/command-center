import { insertRows, selectRows, upsertRows } from "@/lib/supabase/rest"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import type { RuntimeMutationReason } from "@/lib/runtime-event-types"

type ProjectRow = {
  id: string
  name: string
}

type ThreadRow = {
  id: string
  project_id: string
  external_thread_key: string | null
}

type RuntimeEventType =
  | "run_launched"
  | "run_stage_changed"
  | "run_completed"
  | "run_blocked"
  | "run_awaiting_ceo"
  | "decision_created"
  | "decision_resolved"
  | "message_created"
  | "project_runtime_updated"

type RuntimeEventJob = {
  id: string
  projectName: string | null
  chatThreadId?: string | null
  runTemplate?: string | null
  instruction?: string
  status?: string | null
  currentStage?: string | null
  summary?: string | null
  createdAt?: string
  startedAt?: string | null
  completedAt?: string | null
}

const projectCache = new Map<string, ProjectRow>()

async function getProject(projectName: string) {
  const cached = projectCache.get(projectName)
  if (cached) return cached

  const [row] = await selectRows<ProjectRow>("projects", {
    select: "id,name",
    filters: { name: projectName },
    limit: 1,
  })
  if (row) {
    projectCache.set(projectName, row)
  }
  return row ?? null
}

async function ensureThread(projectId: string, projectName: string, chatThreadId?: string | null) {
  if (!chatThreadId) return null

  const [thread] = await upsertRows<ThreadRow>(
    "threads",
    [
      {
        project_id: projectId,
        scope: "project",
        title: `${projectName} chat`,
        external_thread_key: chatThreadId,
        last_message_at: new Date().toISOString(),
      },
    ],
    "project_id,external_thread_key",
  )
  return thread ?? null
}

async function upsertRun(job: RuntimeEventJob, projectId: string, threadId?: string | null) {
  await upsertRows(
    "runs",
    [
      {
        id: job.id,
        project_id: projectId,
        thread_id: threadId ?? null,
        run_template: job.runTemplate ?? null,
        instruction: job.instruction ?? "Runtime event sync",
        status: job.status ?? "queued",
        current_stage: job.currentStage ?? "queued",
        summary: job.summary ?? null,
        trigger_source: job.chatThreadId ? "chat" : "system",
        started_at: job.startedAt ?? null,
        completed_at: job.completedAt ?? null,
      },
    ],
    "id",
  )
}

export async function recordRuntimeEvent(params: {
  eventType: RuntimeEventType
  title: string
  body?: string | null
  scope?: "project" | "portfolio" | "system"
  projectName?: string | null
  chatThreadId?: string | null
  job?: RuntimeEventJob | null
  reason?: RuntimeMutationReason
  payload?: Record<string, unknown>
}) {
  if (!isSupabaseConfigured()) return null
  if (!params.projectName && !params.job?.projectName) return null

  const projectName = params.projectName ?? params.job?.projectName ?? null
  if (!projectName) return null

  const project = await getProject(projectName)
  if (!project) return null

  const job = params.job ?? null
  const thread = await ensureThread(project.id, projectName, params.chatThreadId ?? job?.chatThreadId ?? null)
  if (job) {
    await upsertRun(job, project.id, thread?.id ?? null)
  }

  const [event] = await insertRows("events", [
    {
      project_id: project.id,
      run_id: job?.id ?? null,
      thread_id: thread?.id ?? null,
      event_type: params.eventType,
      title: params.title,
      body: params.body ?? null,
      visibility_scope: params.scope ?? (projectName ? "project" : "system"),
      payload: {
        projectName,
        chatThreadId: params.chatThreadId ?? job?.chatThreadId ?? null,
        jobId: job?.id ?? null,
        status: job?.status ?? null,
        currentStage: job?.currentStage ?? null,
        reason: params.reason,
        ...(params.payload ?? {}),
      },
    },
  ])

  return event ?? null
}

export async function recordProjectRuntimeUpdated(params: {
  projectName: string
  chatThreadId?: string | null
  summary?: string | null
  reason?: RuntimeMutationReason
  job?: RuntimeEventJob | null
  payload?: Record<string, unknown>
}) {
  return recordRuntimeEvent({
    eventType: "project_runtime_updated",
    title: `${params.projectName} runtime updated`,
    body: params.summary ?? params.job?.summary ?? null,
    projectName: params.projectName,
    chatThreadId: params.chatThreadId ?? null,
    scope: "project",
    reason: params.reason ?? "refresh",
    job: params.job ?? null,
    payload: params.payload,
  })
}

export async function recordThreadMessageCreated(params: {
  projectName: string
  chatThreadId: string
  messageCount: number
  body?: string | null
  payload?: Record<string, unknown>
}) {
  return recordRuntimeEvent({
    eventType: "message_created",
    title: "Chat thread updated",
    body: params.body ?? `Saved ${params.messageCount} messages.`,
    projectName: params.projectName,
    chatThreadId: params.chatThreadId,
    scope: "project",
    reason: "refresh",
    payload: {
      messageCount: params.messageCount,
      ...(params.payload ?? {}),
    },
  })
}
