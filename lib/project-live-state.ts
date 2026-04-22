import type { JobStatus, ProjectRuntimeState, ProjectRuntimeStatus, RuntimeJob } from "./orchestration.ts"

function timestampValue(value?: string | null) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function latestJobTimestamp(job: Pick<RuntimeJob, "completedAt" | "stageUpdatedAt" | "startedAt" | "createdAt">) {
  return Math.max(
    timestampValue(job.completedAt),
    timestampValue(job.stageUpdatedAt),
    timestampValue(job.startedAt),
    timestampValue(job.createdAt),
  )
}

function runtimeTimestamp(state?: Pick<ProjectRuntimeState, "completedAt" | "stageUpdatedAt"> | null) {
  if (!state) return 0
  return Math.max(timestampValue(state.stageUpdatedAt), timestampValue(state.completedAt))
}

function runtimeStatusFromJob(status: JobStatus): ProjectRuntimeStatus {
  if (status === "blocked_on_config") return "blocked_on_config"
  if (status === "blocked" || status === "failed" || status === "timed_out") return "blocked"
  if (status === "cancelled") return "cancelled"
  if (status === "awaiting_ceo") return "awaiting_ceo"
  return "healthy"
}

function jobShowsGovernanceUpdate(job: Pick<RuntimeJob, "status">) {
  return job.status === "completed" || job.status === "awaiting_ceo"
}

export function deriveRuntimeStateFromLatestJob(params: {
  projectName: string
  existing?: ProjectRuntimeState | null
  latestJob?: RuntimeJob | null
  messagePreview?: string | null
}): ProjectRuntimeState | null {
  const { existing, latestJob, projectName } = params
  if (!latestJob) return existing ?? null

  const jobTime = latestJobTimestamp(latestJob)
  const existingTime = runtimeTimestamp(existing)
  if (existing && existingTime > jobTime) return existing

  const messagePreview = (params.messagePreview ?? "").trim() || latestJob.summary
  const completedAt = latestJob.completedAt ?? (latestJob.status === "queued" || latestJob.status === "running" ? null : latestJob.stageUpdatedAt)
  const governanceUpdated = jobShowsGovernanceUpdate(latestJob)

  return {
    projectName,
    jobId: latestJob.id,
    runTemplate: latestJob.runTemplate,
    status: runtimeStatusFromJob(latestJob.status),
    summary: latestJob.summary,
    configBlocker: latestJob.configBlocker ?? null,
    governanceUpdated,
    governanceTargets: latestJob.governanceTargets,
    updatedTargets: governanceUpdated ? latestJob.governanceTargets : [],
    missingTargets: governanceUpdated ? [] : latestJob.governanceTargets,
    completedAt,
    messagePreview,
    currentStage: latestJob.currentStage ?? null,
    stageUpdatedAt: latestJob.stageUpdatedAt ?? completedAt,
  }
}

export function liveTimestamp(value?: string | null) {
  return timestampValue(value)
}
