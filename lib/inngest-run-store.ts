import { randomUUID } from "crypto"

import { insertRows, selectRows, updateRows, upsertRows } from "./supabase/rest"
import {
  isInngestArtifactPath,
  isStaleActiveRun,
  isStaleQueuedRun,
  mapSupabaseRunToRuntimeJob,
  parseInngestArtifactPath,
  supabaseArtifactPath,
  assertEvidenceBeforeDone,
  type SupabaseArtifactRow,
  type SupabaseRunRow,
} from "./inngest-run-presentation"

export {
  assertEvidenceBeforeDone,
  isInngestArtifactPath,
  isStaleActiveRun,
  mapSupabaseRunToRuntimeJob,
  parseInngestArtifactPath,
  isStaleQueuedRun,
  supabaseArtifactPath,
  type SupabaseArtifactRow,
  type SupabaseRunRow,
} from "./inngest-run-presentation"

type ProjectRow = {
  id: string
  name: string
  repo_path: string
  metadata?: Record<string, unknown> | null
}

type ThreadRow = {
  id: string
  project_id: string
  external_thread_key: string | null
}

type RunStepRow = {
  id: string
  run_id: string
  step_key: string
  step_type: string
  status: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  error: Record<string, unknown> | null
  started_at: string | null
  completed_at: string | null
}

const ENGINE = "inngest"

function latestArtifact(artifacts: SupabaseArtifactRow[], artifactType: string) {
  return artifacts
    .filter((artifact) => artifact.artifact_type === artifactType)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null
}

export function isInngestManagedRun(job: { runTemplate?: string | null; metadata?: Record<string, unknown> | null }) {
  return job.runTemplate === "continue_project" || job.metadata?.engine === ENGINE
}

async function getProject(projectName: string) {
  const [project] = await selectRows<ProjectRow>("projects", {
    select: "id,name,repo_path",
    filters: { name: projectName },
    limit: 1,
  })

  if (!project) {
    throw new Error(`Project ${projectName} was not found in Supabase.`)
  }

  return project
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

export async function createProjectTaskRun(params: {
  projectName: string
  chatThreadId?: string | null
  runTemplate: "custom" | "continue_project" | "fix_blocker" | "fix_issue" | "review_next_move" | "prep_qa" | "investigate_issue"
  instruction: string
  successCriteria: string[]
  governanceTargets: string[]
}) {
  const project = await getProject(params.projectName)
  return createManagedRun({
    storageProject: project,
    presentedProjectName: params.projectName,
    chatThreadId: params.chatThreadId ?? null,
    runTemplate: params.runTemplate,
    instruction: params.instruction,
    successCriteria: params.successCriteria,
    governanceTargets: params.governanceTargets,
    workingDirectory: project.repo_path,
    jobType: "project_task",
  })
}

async function createManagedRun(params: {
  storageProject: ProjectRow
  presentedProjectName: string | null
  chatThreadId?: string | null
  runTemplate: "custom" | "continue_project" | "fix_blocker" | "fix_issue" | "review_next_move" | "prep_qa" | "investigate_issue" | null
  instruction: string
  successCriteria: string[]
  governanceTargets: string[]
  workingDirectory: string
  jobType: "project_task" | "orchestrator_run" | "system_task"
}) {
  const project = params.storageProject
  const presentedProjectName = params.presentedProjectName
  const thread =
    params.chatThreadId && presentedProjectName ? await ensureThread(project.id, presentedProjectName, params.chatThreadId ?? null) : null
  const now = new Date().toISOString()
  const id = randomUUID()

  const [run] = await insertRows<SupabaseRunRow>("runs", [
    {
      id,
      project_id: project.id,
      thread_id: thread?.id ?? null,
      run_template: params.runTemplate,
      instruction: params.instruction,
      status: "queued",
      current_stage: "queued",
      summary: "Worker launched.",
      trigger_source: params.chatThreadId ? "chat" : "system",
      metadata: {
        engine: ENGINE,
        jobType: params.jobType,
        projectName: presentedProjectName,
        chatThreadId: params.chatThreadId ?? null,
        workingDirectory: params.workingDirectory,
        successCriteria: params.successCriteria,
        governanceTargets: params.governanceTargets,
        stageUpdatedAt: now,
      },
      created_at: now,
      updated_at: now,
    },
  ])

  await updateRows(
    "projects",
    {
      ...(presentedProjectName
        ? {
            current_run_id: id,
            current_stage: "queued",
            runtime_summary: "Worker launched.",
          }
        : {}),
      last_event_at: now,
    },
    { id: project.id },
  )

  return run
}

export async function createContinueProjectRun(params: {
  projectName: string
  chatThreadId?: string | null
  instruction: string
  successCriteria: string[]
  governanceTargets: string[]
}) {
  return createProjectTaskRun({
    ...params,
    runTemplate: "continue_project",
  })
}

export async function createOrchestratorRun(params: {
  instruction: string
  workingDirectory: string
}) {
  const storageProject = await getProject("command-center")
  return createManagedRun({
    storageProject,
    presentedProjectName: null,
    chatThreadId: null,
    runTemplate: null,
    instruction: params.instruction,
    successCriteria: [],
    governanceTargets: [],
    workingDirectory: params.workingDirectory,
    jobType: "orchestrator_run",
  })
}

export async function updateRunRecord(
  runId: string,
  updates: Partial<{
    status: string
    current_stage: string
    summary: string | null
    started_at: string | null
    completed_at: string | null
    metadata: Record<string, unknown>
  }>,
) {
  const [existing] = await selectRows<SupabaseRunRow>("runs", {
    select: "id,project_id,thread_id,run_template,instruction,status,current_stage,summary,created_at,started_at,completed_at,metadata",
    filters: { id: runId },
    limit: 1,
  })

  if (!existing) {
    throw new Error(`Run ${runId} was not found.`)
  }

  const [updated] = await upsertRows<SupabaseRunRow>(
    "runs",
    [
      {
        id: runId,
        project_id: existing.project_id,
        thread_id: existing.thread_id,
        run_template: existing.run_template,
        instruction: existing.instruction,
        status: updates.status ?? existing.status,
        current_stage: updates.current_stage ?? existing.current_stage,
        summary: updates.summary ?? existing.summary,
        started_at: updates.started_at ?? existing.started_at,
        completed_at: updates.completed_at ?? existing.completed_at,
        metadata: {
          ...(existing.metadata ?? {}),
          ...(updates.metadata ?? {}),
        },
      },
    ],
    "id",
  )

  return updated ?? existing
}

export async function touchRunHeartbeat(runId: string, heartbeatAt = new Date().toISOString()) {
  return updateRunRecord(runId, {
    metadata: {
      lastHeartbeatAt: heartbeatAt,
    },
  })
}

export async function findTrackedStep(runId: string, stepKey: string) {
  const [step] = await selectRows<RunStepRow>("run_steps", {
    select: "id,run_id,step_key,step_type,status,input,output,error,started_at,completed_at",
    filters: {
      run_id: runId,
      step_key: stepKey,
    },
    limit: 1,
  })

  return step ?? null
}

export async function upsertTrackedStep(params: {
  runId: string
  stepKey: string
  stepType: string
  status: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: Record<string, unknown> | null
  startedAt?: string | null
  completedAt?: string | null
}) {
  const existing = await findTrackedStep(params.runId, params.stepKey)
  const [row] = await upsertRows<RunStepRow>(
    "run_steps",
    [
      {
        id: existing?.id ?? randomUUID(),
        run_id: params.runId,
        step_key: params.stepKey,
        step_type: params.stepType,
        status: params.status,
        input: params.input ?? existing?.input ?? {},
        output: params.output ?? existing?.output ?? {},
        error: params.error ?? existing?.error ?? null,
        started_at: params.startedAt ?? existing?.started_at ?? null,
        completed_at: params.completedAt ?? existing?.completed_at ?? null,
      },
    ],
    "id",
  )

  return row ?? existing
}

export async function createRunArtifact(params: {
  projectName: string
  runId: string
  artifactType: string
  label: string
  content?: string | null
  metadata?: Record<string, unknown>
}) {
  const project = await getProject(params.projectName)
  const [artifact] = await insertRows<SupabaseArtifactRow>("artifacts", [
    {
      id: randomUUID(),
      project_id: project.id,
      run_id: params.runId,
      artifact_type: params.artifactType,
      label: params.label,
      content: params.content ?? null,
      metadata: params.metadata ?? {},
    },
  ])

  return artifact ?? null
}

export async function listRunArtifacts(runId: string) {
  return selectRows<SupabaseArtifactRow>("artifacts", {
    select: "id,run_id,artifact_type,label,content,metadata,created_at",
    filters: { run_id: runId },
    order: "created_at.asc",
  })
}

export async function readRunArtifactContent(pathValue: string) {
  const parsed = parseInngestArtifactPath(pathValue)
  if (!parsed) return ""

  const artifact = latestArtifact(await listRunArtifacts(parsed.runId), parsed.artifactType)
  return artifact?.content ?? ""
}

export const readInngestArtifactContent = readRunArtifactContent

export async function listInngestRuns(projectName?: string) {
  const filters = projectName ? { projectName } : undefined
  const runs = await selectRows<SupabaseRunRow>("runs", {
    select: "id,project_id,thread_id,run_template,instruction,status,current_stage,summary,created_at,started_at,completed_at,metadata",
    order: "created_at.desc",
  })

  const filtered = runs.filter((run) => {
    const metadata = run.metadata ?? {}
    if (metadata.engine !== ENGINE) return false
    if (projectName && metadata.projectName !== projectName) return false
    return true
  })

  const artifactsByRun = new Map<string, SupabaseArtifactRow[]>()
  await Promise.all(
    filtered.map(async (run) => {
      artifactsByRun.set(run.id, await listRunArtifacts(run.id))
    }),
  )

  return filtered.map((run) => mapSupabaseRunToRuntimeJob(run, artifactsByRun.get(run.id) ?? []))
}

export async function expireStaleQueuedRuns(projectName?: string, now = new Date()) {
  const runs = await selectRows<SupabaseRunRow>("runs", {
    select: "id,project_id,thread_id,run_template,instruction,status,current_stage,summary,created_at,started_at,completed_at,metadata",
    order: "created_at.desc",
  })

  const staleRuns = runs.filter((run) => {
    const metadata = run.metadata ?? {}
    if (metadata.engine !== ENGINE) return false
    if (projectName && metadata.projectName !== projectName) return false
    return isStaleQueuedRun(run, now)
  })

  await Promise.all(
    staleRuns.map(async (run) => {
      const metadata = run.metadata ?? {}
      const projectNameForArtifact = typeof metadata.projectName === "string" ? metadata.projectName : null
      const completedAt = now.toISOString()
      const summary = "Worker launch timed out before Inngest picked it up. Retry the run."
      await updateRunRecord(run.id, {
        status: "timed_out",
        current_stage: "blocked",
        summary,
        completed_at: completedAt,
        metadata: {
          stageUpdatedAt: completedAt,
          dispatchTimedOutAt: completedAt,
        },
      })
      if (projectNameForArtifact) {
        const [project] = await selectRows<ProjectRow>("projects", {
          select: "id,name,repo_path,metadata",
          filters: { id: run.project_id },
          limit: 1,
        }).catch(() => [])
        const projectMetadata = project?.metadata && typeof project.metadata === "object" ? project.metadata : {}
        const runtimeState = {
          projectName: projectNameForArtifact,
          jobId: run.id,
          runTemplate: run.run_template,
          status: "blocked",
          summary,
          governanceUpdated: false,
          governanceTargets: Array.isArray(metadata.governanceTargets) ? metadata.governanceTargets : [],
          updatedTargets: [],
          missingTargets: [],
          completedAt,
          messagePreview: summary,
          currentStage: "blocked",
          stageUpdatedAt: completedAt,
        }
        await updateRows(
          "projects",
          {
            current_run_id: run.id,
            runtime_status: "blocked",
            runtime_summary: summary,
            current_stage: "blocked",
            governance_updated: false,
            last_run_completed_at: completedAt,
            metadata: {
              ...projectMetadata,
              runtimeState,
              phase1: {
                ...((projectMetadata.phase1 as Record<string, unknown> | undefined) ?? {}),
                portfolioProject: {
                  ...((((projectMetadata.phase1 as Record<string, unknown> | undefined)?.portfolioProject as Record<string, unknown> | undefined) ??
                    {}) as Record<string, unknown>),
                  runtimeState: {
                    status: "blocked",
                    statusLabel: "Blocked",
                    summary,
                    currentStage: "blocked",
                  },
                },
              },
            },
          },
          { id: run.project_id },
        ).catch(() => [])
        await createRunArtifact({
          projectName: projectNameForArtifact,
          runId: run.id,
          artifactType: "execution_log",
          label: "Dispatch timeout",
          content:
            "The run stayed queued without a start timestamp until the dispatch timeout expired. Inngest did not pick up the event for execution, so no worker process or execution log was created. Retry the run after confirming the dev worker is connected.",
          metadata: {
            dispatchTimedOutAt: completedAt,
          },
        }).catch(() => null)
      }
    }),
  )

  return staleRuns.length
}

export async function expireStaleActiveRuns(projectName?: string, now = new Date()) {
  const runs = await selectRows<SupabaseRunRow>("runs", {
    select: "id,project_id,thread_id,run_template,instruction,status,current_stage,summary,created_at,started_at,completed_at,metadata",
    order: "created_at.desc",
  })

  const staleRuns = runs.filter((run) => {
    const metadata = run.metadata ?? {}
    if (metadata.engine !== ENGINE) return false
    if (projectName && metadata.projectName !== projectName) return false
    return isStaleActiveRun(run, now)
  })

  await Promise.all(
    staleRuns.map(async (run) => {
      const metadata = run.metadata ?? {}
      const projectNameForArtifact = typeof metadata.projectName === "string" ? metadata.projectName : null
      const completedAt = now.toISOString()
      const summary = "Worker heartbeat was lost. The run is no longer live; retry it if the work is still needed."
      await updateRunRecord(run.id, {
        status: "timed_out",
        current_stage: "blocked",
        summary,
        completed_at: completedAt,
        metadata: {
          stageUpdatedAt: completedAt,
          heartbeatLostAt: completedAt,
          activeProcessPid: null,
          exitCode: 124,
        },
      })
      if (projectNameForArtifact) {
        const [project] = await selectRows<ProjectRow>("projects", {
          select: "id,name,repo_path,metadata",
          filters: { id: run.project_id },
          limit: 1,
        }).catch(() => [])
        const projectMetadata = project?.metadata && typeof project.metadata === "object" ? project.metadata : {}
        const runtimeState = {
          projectName: projectNameForArtifact,
          jobId: run.id,
          runTemplate: run.run_template,
          status: "blocked",
          summary,
          governanceUpdated: false,
          governanceTargets: Array.isArray(metadata.governanceTargets) ? metadata.governanceTargets : [],
          updatedTargets: [],
          missingTargets: [],
          completedAt,
          messagePreview: summary,
          currentStage: "blocked",
          stageUpdatedAt: completedAt,
        }
        await updateRows(
          "projects",
          {
            current_run_id: run.id,
            runtime_status: "blocked",
            runtime_summary: summary,
            current_stage: "blocked",
            governance_updated: false,
            last_run_completed_at: completedAt,
            metadata: {
              ...projectMetadata,
              runtimeState,
              phase1: {
                ...((projectMetadata.phase1 as Record<string, unknown> | undefined) ?? {}),
                portfolioProject: {
                  ...((((projectMetadata.phase1 as Record<string, unknown> | undefined)?.portfolioProject as Record<string, unknown> | undefined) ??
                    {}) as Record<string, unknown>),
                  runtimeState: {
                    status: "blocked",
                    statusLabel: "Blocked",
                    summary,
                    currentStage: "blocked",
                  },
                },
              },
            },
          },
          { id: run.project_id },
        ).catch(() => [])
        await createRunArtifact({
          projectName: projectNameForArtifact,
          runId: run.id,
          artifactType: "execution_log",
          label: "Worker heartbeat lost",
          content:
            "The run was marked running, but Command Center stopped receiving heartbeat/activity updates. The worker process is not considered live anymore, so this run was closed as timed out instead of leaving a stale running card. Retry the run if the assignment is still needed.",
          metadata: {
            heartbeatLostAt: completedAt,
          },
        }).catch(() => null)
      }
    }),
  )

  return staleRuns.length
}

export async function readInngestManagedRun(runId: string) {
  const [run] = await selectRows<SupabaseRunRow>("runs", {
    select: "id,project_id,thread_id,run_template,instruction,status,current_stage,summary,created_at,started_at,completed_at,metadata",
    filters: { id: runId },
    limit: 1,
  })

  if (!run || run.metadata?.engine !== ENGINE) return null
  return run
}
