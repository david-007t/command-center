import type { ProjectRuntimeState } from "../orchestration"

type RuntimeStateStatus = ProjectRuntimeState["status"]
type RuntimeStateStage = ProjectRuntimeState["currentStage"]

export type RuntimeStateProjectRow = {
  id: string
  name: string
  current_run_id: string | null
  runtime_status: RuntimeStateStatus | null
  runtime_summary: string | null
  current_stage: RuntimeStateStage | null
  governance_updated: boolean | null
  last_run_completed_at: string | null
  metadata: Record<string, unknown>
}

type RuntimeStateMetadata = {
  runtimeState?: ProjectRuntimeState
  phase1?: {
    portfolioProject?: {
      runtimeState?: {
        status: string
        statusLabel: string
        summary: string
        currentStage?: string | null
      } | null
    }
  }
}

function cloneMetadata(metadata?: Record<string, unknown> | null): RuntimeStateMetadata {
  return metadata && typeof metadata === "object" ? { ...(metadata as RuntimeStateMetadata) } : {}
}

export function projectRowToRuntimeState(row: RuntimeStateProjectRow): ProjectRuntimeState | null {
  const metadata = cloneMetadata(row.metadata)
  const stored = metadata.runtimeState
  if (stored) {
    return stored
  }

  if (!row.current_run_id || !row.runtime_status) {
    return null
  }

  return {
    projectName: row.name,
    jobId: row.current_run_id,
    runTemplate: null,
    status: row.runtime_status,
    summary: row.runtime_summary ?? "",
    governanceUpdated: Boolean(row.governance_updated),
    governanceTargets: [],
    updatedTargets: [],
    missingTargets: [],
    completedAt: row.last_run_completed_at,
    messagePreview: row.runtime_summary ?? "",
    currentStage: row.current_stage ?? null,
    stageUpdatedAt: row.last_run_completed_at,
  }
}

export function runtimeStateToProjectUpdate(
  state: ProjectRuntimeState,
  existingMetadata?: Record<string, unknown> | null,
) {
  const metadata = cloneMetadata(existingMetadata)
  metadata.runtimeState = state
  metadata.phase1 = {
    ...(metadata.phase1 ?? {}),
    portfolioProject: {
      ...(metadata.phase1?.portfolioProject ?? {}),
      runtimeState: {
        status: state.status,
        statusLabel: state.status
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
        summary: state.summary,
        currentStage: state.currentStage,
      },
    },
  }

  return {
    current_run_id: state.jobId,
    runtime_status: state.status,
    runtime_summary: state.summary,
    current_stage: state.currentStage,
    governance_updated: state.governanceUpdated,
    last_run_completed_at: state.completedAt,
    metadata,
  }
}
