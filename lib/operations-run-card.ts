type OperationsJob = {
  id: string
  projectName: string | null
  status: string
  instruction: string
  createdAt: string
  completedAt?: string | null
  stageUpdatedAt?: string | null
  summary: string
  currentStage: string
}

export type OperationsRun = {
  id: string
  projectName: string | null
  status: string
  statusLabel: string
  instruction: string
  createdAt: string
  completedAt?: string | null
  stageUpdatedAt?: string | null
  summary: string
  oneLineResult: string
  currentStage: string
}

const STALE_ACTIVE_TIMEOUT_MS = 6 * 60 * 1000
const HEARTBEAT_LOST_SUMMARY = "Worker heartbeat was lost. The run is no longer live; retry it if the work is still needed."

function statusLabel(status: string) {
  if (status === "awaiting_ceo") return "Needs your decision"
  if (status === "blocked_on_config") return "Blocked on config"
  if (status === "blocked") return "Blocked"
  if (status === "completed") return "Completed"
  if (status === "running") return "In progress"
  if (status === "queued") return "Queued"
  if (status === "failed") return "Needs recovery"
  if (status === "timed_out") return "Timed out"
  if (status === "cancelled") return "Paused"
  return status.replaceAll("_", " ")
}

function oneLineResultForJob(job: OperationsJob) {
  const cleaned = job.summary.replace(/\s+/g, " ").trim()
  if (cleaned) return cleaned
  if (job.status === "completed") return "Worker completed the assignment."
  if (job.status === "awaiting_ceo") return "Worker finished and needs your decision."
  if (job.status === "failed" || job.status === "timed_out" || job.status === "blocked") return "Worker stopped before completion."
  if (job.status === "cancelled") return "Worker was cancelled."
  return "Worker updated the project."
}

export function mapJobToOperationsRun(job: OperationsJob): OperationsRun {
  return {
    id: job.id,
    projectName: job.projectName,
    status: job.status,
    statusLabel: statusLabel(job.status),
    instruction: job.instruction,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    stageUpdatedAt: job.stageUpdatedAt,
    summary: job.summary,
    oneLineResult: oneLineResultForJob(job),
    currentStage: job.currentStage,
  }
}

function isActiveOperationsRun(run: OperationsRun) {
  return run.status === "running" || run.status === "queued"
}

function isStaleActiveRun(run: OperationsRun, now: Date) {
  if (run.status !== "running") return false
  const timestamp = run.stageUpdatedAt ?? run.completedAt ?? run.createdAt
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return false
  return now.getTime() - parsed > STALE_ACTIVE_TIMEOUT_MS
}

function markRunTimedOut(run: OperationsRun): OperationsRun {
  return {
    ...run,
    status: "timed_out",
    statusLabel: statusLabel("timed_out"),
    currentStage: "blocked",
    summary: HEARTBEAT_LOST_SUMMARY,
    oneLineResult: HEARTBEAT_LOST_SUMMARY,
  }
}

export function splitOperationsRuns(runs: OperationsRun[], now = new Date()) {
  const normalized = runs.map((run) => (isStaleActiveRun(run, now) ? markRunTimedOut(run) : run))
  return {
    activeRuns: normalized.filter(isActiveOperationsRun),
    recentRuns: normalized.filter((run) => !isActiveOperationsRun(run)).slice(0, 8),
  }
}
