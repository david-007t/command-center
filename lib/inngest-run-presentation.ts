import type { RuntimeJob } from "./orchestration"

export type SupabaseRunRow = {
  id: string
  project_id: string
  thread_id: string | null
  run_template: string | null
  instruction: string
  status: string
  current_stage: string
  summary: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  metadata: Record<string, unknown> | null
}

export type SupabaseArtifactRow = {
  id: string
  run_id: string
  artifact_type: string
  label: string
  content: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export function supabaseArtifactPath(runId: string, artifactType: string) {
  return `supabase://runs/${runId}/${artifactType}`
}

export function isInngestArtifactPath(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith("supabase://runs/")
}

export function parseInngestArtifactPath(value: string) {
  const match = value.match(/^supabase:\/\/runs\/([^/]+)\/([^/]+)$/)
  if (!match) return null

  return {
    runId: match[1],
    artifactType: match[2],
  }
}

export function mapSupabaseRunToRuntimeJob(
  row: SupabaseRunRow,
  _artifacts: SupabaseArtifactRow[] = [],
): RuntimeJob {
  const metadata = row.metadata ?? {}
  const jobType =
    metadata.jobType === "orchestrator_run" || metadata.jobType === "system_task" || metadata.jobType === "project_task"
      ? (metadata.jobType as RuntimeJob["type"])
      : "project_task"
  const projectName = typeof metadata.projectName === "string" ? metadata.projectName : null
  const chatThreadId = typeof metadata.chatThreadId === "string" ? metadata.chatThreadId : null
  const workingDirectory =
    typeof metadata.workingDirectory === "string"
      ? metadata.workingDirectory
      : `inngest://${projectName ?? "system"}/${row.id}`

  return {
    id: row.id,
    type: jobType,
    runTemplate: (row.run_template as RuntimeJob["runTemplate"]) ?? null,
    projectName,
    chatThreadId,
    instruction: row.instruction,
    successCriteria: Array.isArray(metadata.successCriteria) ? (metadata.successCriteria as string[]) : [],
    governanceTargets: Array.isArray(metadata.governanceTargets) ? (metadata.governanceTargets as string[]) : [],
    status: row.status as RuntimeJob["status"],
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    logPath: supabaseArtifactPath(row.id, "execution_log"),
    messagePath: supabaseArtifactPath(row.id, "message_preview"),
    commentaryPath: supabaseArtifactPath(row.id, "commentary"),
    workingDirectory,
    summary: row.summary ?? "Queued.",
    initialGitHead: typeof metadata.initialGitHead === "string" ? metadata.initialGitHead : null,
    configBlocker:
      metadata.configBlocker && typeof metadata.configBlocker === "object"
        ? (metadata.configBlocker as RuntimeJob["configBlocker"])
        : null,
    exitCode: typeof metadata.exitCode === "number" ? metadata.exitCode : null,
    pid: null,
    currentStage: row.current_stage as RuntimeJob["currentStage"],
    stageUpdatedAt:
      typeof metadata.stageUpdatedAt === "string"
        ? metadata.stageUpdatedAt
        : row.completed_at ?? row.started_at ?? row.created_at,
  }
}

export function assertEvidenceBeforeDone(params: {
  run: Pick<SupabaseRunRow, "status" | "current_stage">
  artifacts: SupabaseArtifactRow[]
}) {
  if (params.run.status !== "completed" && params.run.current_stage !== "done") {
    return
  }

  const evidenceReady = params.artifacts.some((artifact) =>
    ["verification", "message_preview", "evidence"].includes(artifact.artifact_type),
  )

  if (!evidenceReady) {
    throw new Error("Evidence artifacts must be written before the run can be marked done.")
  }
}
