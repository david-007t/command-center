import { promises as fs } from "fs"
import path from "path"
import { inngest, CONTINUE_PROJECT_EVENT, PROJECT_TASK_EVENT } from "@/inngest/client"
import { INVESTIGATE_PROJECT_EVENT, ORCHESTRATOR_RUN_EVENT } from "@/inngest/client"
import {
  createContinueProjectRun,
  createOrchestratorRun,
  createProjectTaskRun,
  isInngestArtifactPath,
  listInngestRuns,
  mapSupabaseRunToRuntimeJob,
  readInngestArtifactContent,
  readInngestManagedRun,
  updateRunRecord,
} from "@/lib/inngest-run-store"
import { COMMAND_CENTER_PROJECT, resolveProjectDir } from "@/lib/managed-projects"
import { recordProjectRuntimeUpdated, recordRuntimeEvent } from "@/lib/runtime-events"
import { projectRowToRuntimeState, runtimeStateToProjectUpdate, type RuntimeStateProjectRow } from "@/lib/runtime-store/runtime-state"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { selectRows, upsertRows } from "@/lib/supabase/rest"
import { chooseProjectRunTemplate } from "./sprint-dispatch"

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "awaiting_ceo"
  | "blocked"
  | "blocked_on_config"
export type JobType = "project_task" | "orchestrator_run" | "system_task"
export type ProjectRunTemplate = "custom" | "continue_project" | "fix_blocker" | "fix_issue" | "review_next_move" | "prep_qa" | "investigate_issue"
export type ProjectRuntimeStatus = "healthy" | "stale_governance" | "awaiting_ceo" | "blocked" | "blocked_on_config" | "cancelled"
export const RUNTIME_JOB_STAGES = [
  "queued",
  "reading_context",
  "planning",
  "executing",
  "verifying",
  "updating_governance",
  "done",
  "blocked",
] as const
export type RuntimeJobStage = (typeof RUNTIME_JOB_STAGES)[number]

const RUNTIME_JOB_STAGE_META: Record<RuntimeJobStage, { label: string; description: string; index: number }> = {
  queued: {
    label: "Queued",
    description: "The assignment is waiting for the worker to start.",
    index: 0,
  },
  reading_context: {
    label: "Reading context",
    description: "The worker is reading project files and current state before acting.",
    index: 1,
  },
  planning: {
    label: "Planning",
    description: "The worker is deciding the narrowest safe next move.",
    index: 2,
  },
  executing: {
    label: "Executing",
    description: "The worker is making the requested change or investigation.",
    index: 3,
  },
  verifying: {
    label: "Verifying",
    description: "The worker is checking whether the result actually worked.",
    index: 4,
  },
  updating_governance: {
    label: "Updating governance",
    description: "The worker is refreshing logs, handoff, or runtime records.",
    index: 5,
  },
  done: {
    label: "Done",
    description: "The assignment finished cleanly.",
    index: 6,
  },
  blocked: {
    label: "Blocked",
    description: "The assignment stopped before completion and needs attention.",
    index: 6,
  },
}

export type RuntimeJob = {
  id: string
  type: JobType
  runTemplate: ProjectRunTemplate | null
  projectName: string | null
  chatThreadId?: string | null
  instruction: string
  successCriteria: string[]
  governanceTargets: string[]
  status: JobStatus
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  logPath: string
  messagePath: string | null
  commentaryPath: string | null
  workingDirectory: string
  summary: string
  initialGitHead?: string | null
  configBlocker?: {
    credential: string
    detail: string
    nextStep: string
  } | null
  exitCode: number | null
  pid: number | null
  currentStage: RuntimeJobStage
  stageUpdatedAt: string
}

export type ProjectRunSpec = {
  template: ProjectRunTemplate
  label: string
  instruction: string
  successCriteria: string[]
  governanceTargets: string[]
}

export type SprintPrioritySnapshot = {
  sprintGoal: string
  inProgress: string[]
  upNext: string[]
  blocked: string[]
  highestPriorityTask: string | null
  source: "in_progress" | "up_next" | "sprint_goal" | "none"
}

export type ProjectRuntimeState = {
  projectName: string
  jobId: string
  runTemplate: ProjectRunTemplate | null
  status: ProjectRuntimeStatus
  summary: string
  configBlocker?: {
    credential: string
    detail: string
    nextStep: string
  } | null
  governanceUpdated: boolean
  governanceTargets: string[]
  updatedTargets: string[]
  missingTargets: string[]
  completedAt: string | null
  messagePreview: string
  currentStage: RuntimeJobStage | null
  stageUpdatedAt: string | null
}

export function getStageMeta(stage: RuntimeJobStage) {
  return RUNTIME_JOB_STAGE_META[stage]
}

export type CeoDecision = {
  projectName: string
  title: string
  reason: string
  recommendation: string
  priority: "critical" | "important"
  source: "runtime" | "portfolio"
}

export function getDeveloperPath() {
  const developerPath = process.env.DEVELOPER_PATH
  if (!developerPath) {
    throw new Error("DEVELOPER_PATH is not configured.")
  }

  return developerPath
}

function assertManagedRuntimeConfigured() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase runtime is required for the migrated Command Center engine.")
  }
}

function markdownSection(markdown: string, title: string) {
  return markdown.match(new RegExp(`## ${title}([\\s\\S]*?)(\\n## |$)`))?.[1]?.trim() ?? ""
}

function markdownBullets(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- \[[ xX]\]\s*/, "").replace(/^- /, "").trim())
    .filter(Boolean)
}

function firstNonEmptyLine(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? ""
}

export async function readSprintPrioritySnapshot(developerPath: string, projectName: string): Promise<SprintPrioritySnapshot> {
  const tasksPath = path.join(resolveProjectDir(developerPath, projectName), "TASKS.md")
  const markdown = await fs.readFile(tasksPath, "utf8").catch(() => "")
  const sprintGoal = firstNonEmptyLine(markdownSection(markdown, "Current sprint goal"))
  const inProgress = markdownBullets(markdownSection(markdown, "In progress"))
  const upNext = markdownBullets(markdownSection(markdown, "Up next"))
  const blocked = markdownBullets(markdownSection(markdown, "Blocked"))
  const highestPriorityTask = inProgress[0] || upNext[0] || sprintGoal || null
  const source = inProgress[0] ? "in_progress" : upNext[0] ? "up_next" : sprintGoal ? "sprint_goal" : "none"

  return {
    sprintGoal,
    inProgress,
    upNext,
    blocked,
    highestPriorityTask,
    source,
  }
}

export async function listJobs(developerPath: string, projectName?: string) {
  void developerPath
  assertManagedRuntimeConfigured()
  return (await listInngestRuns(projectName).catch(() => [])).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function getActiveJobs(_developerPath: string, projectName?: string) {
  const jobs = await listJobs(_developerPath, projectName)
  return jobs.filter((job) => job.status === "queued" || job.status === "running")
}

export async function readMessagePreview(messagePath: string | null) {
  if (!messagePath) return ""
  if (isInngestArtifactPath(messagePath)) {
    return readInngestArtifactContent(messagePath).catch(() => "")
  }
  const content = await fs.readFile(messagePath, "utf8").catch(() => "")
  return content.split("\n").slice(0, 12).join("\n")
}

export async function readCommentaryPreview(commentaryPath: string | null, lineCount = 16) {
  if (!commentaryPath) return ""
  if (isInngestArtifactPath(commentaryPath)) {
    const content = await readInngestArtifactContent(commentaryPath).catch(() => "")
    return content.split("\n").filter(Boolean).slice(-lineCount).join("\n")
  }
  const content = await fs.readFile(commentaryPath, "utf8").catch(() => "")
  return content.split("\n").filter(Boolean).slice(-lineCount).join("\n")
}

export async function readLogPreview(logPath: string, lineCount = 10) {
  if (isInngestArtifactPath(logPath)) {
    const content = await readInngestArtifactContent(logPath).catch(() => "")
    return content.split("\n").filter(Boolean).slice(-lineCount).join("\n")
  }
  const content = await fs.readFile(logPath, "utf8").catch(() => "")
  return content.split("\n").filter(Boolean).slice(-lineCount).join("\n")
}

export async function readProjectRuntimeState(developerPath: string, projectName: string) {
  void developerPath
  assertManagedRuntimeConfigured()
  const [row] = await selectRows<RuntimeStateProjectRow>("projects", {
    select: "id,name,current_run_id,runtime_status,runtime_summary,current_stage,governance_updated,last_run_completed_at,metadata",
    filters: { name: projectName },
    limit: 1,
  })

  return row ? projectRowToRuntimeState(row) : null
}

export function recommendRunTemplate(params: {
  projectName: string
  instruction: string
  runtimeState?: ProjectRuntimeState | null
}): ProjectRunTemplate {
  const instruction = params.instruction.toLowerCase()
  const runtimeState = params.runtimeState

  if (/fix issue|fix this|implement the fix|write code|commit/i.test(instruction)) {
    return "fix_issue"
  }

  if (/qa|quality|security|staging|ship|launch review/.test(instruction)) {
    return "prep_qa"
  }

  if (/investigat|diagnos|debug|why|unverified|trust|preview deploy|vercel/.test(instruction)) {
    return "investigate_issue"
  }

  if (/review|assess|what next|next move|priorit/i.test(instruction)) {
    return "review_next_move"
  }

  if (/blocker|bug|fix|repair|debug|broken|error|issue/.test(instruction)) {
    return "fix_issue"
  }

  if (runtimeState?.status === "awaiting_ceo") {
    return "review_next_move"
  }

  if (runtimeState?.status === "blocked" || runtimeState?.status === "stale_governance") {
    return "fix_issue"
  }

  return "continue_project"
}

export async function recommendRunTemplateForProject(params: {
  developerPath: string
  projectName: string
  instruction: string
  runtimeState?: ProjectRuntimeState | null
}): Promise<ProjectRunTemplate> {
  const priority = await readSprintPrioritySnapshot(params.developerPath, params.projectName).catch(() => null)
  return chooseProjectRunTemplate({
    instruction: params.instruction,
    hasPriorityTask: Boolean(priority?.highestPriorityTask),
    runtimeStatus: params.runtimeState?.status ?? null,
  }) as ProjectRunTemplate
}

export function summarizeRecommendedAction(runtimeState?: ProjectRuntimeState | null) {
  if (!runtimeState) {
    return {
      template: "continue_project" as ProjectRunTemplate,
      label: "Continue project",
      reason: "No reconciled runtime state exists yet, so the safest next move is to continue the project using TASKS.md and HANDOFF.md.",
    }
  }

  if (runtimeState.status === "awaiting_ceo") {
    return {
      template: "review_next_move" as ProjectRunTemplate,
      label: "Review next move",
      reason: "The last run surfaced a decision for the CEO, so the safest action is to review the recommendation rather than launch more implementation blindly.",
    }
  }

  if (runtimeState.status === "blocked" || runtimeState.status === "stale_governance") {
    return {
      template: "investigate_issue" as ProjectRunTemplate,
      label: "Investigate issue",
      reason: "The last reconciled state shows either a blocker or incomplete governance updates, so the system should diagnose the cause before claiming a fix.",
    }
  }

  if (runtimeState.status === "cancelled") {
    return {
      template: "continue_project" as ProjectRunTemplate,
      label: "Continue project",
      reason: "The last run was cancelled, so the most useful next move is to resume with a clearly scoped continuation task.",
    }
  }

  if (runtimeState.currentStage && !runtimeState.completedAt) {
    return {
      template: "continue_project" as ProjectRunTemplate,
      label: "Continue project",
      reason: `The worker is currently ${getStageMeta(runtimeState.currentStage).label.toLowerCase()}, so the best next move is to let that assignment finish.`,
    }
  }

  return {
    template: "continue_project" as ProjectRunTemplate,
    label: "Continue project",
    reason: "The project is currently in a healthy reconciled state, so it can keep advancing the planned work.",
  }
}

export function deriveCeoDecision(projectName: string, runtimeState?: ProjectRuntimeState | null): CeoDecision | null {
  if (!runtimeState) return null

  if (runtimeState.status === "awaiting_ceo") {
    return {
      projectName,
      title: "Decision needed",
      reason: runtimeState.messagePreview || runtimeState.summary,
      recommendation: "Review the recommended next move before approving more development on this project.",
      priority: "critical",
      source: "runtime",
    }
  }

  if (runtimeState.status === "blocked") {
    return {
      projectName,
      title: "Blocker needs direction",
      reason: runtimeState.messagePreview || runtimeState.summary,
      recommendation: "Choose whether the system should investigate, change scope, or pause this project.",
      priority: "important",
      source: "runtime",
    }
  }

  if (runtimeState.status === "stale_governance") {
    return {
      projectName,
      title: "Governance needs reconciliation",
      reason: runtimeState.summary,
      recommendation: "Run a governance refresh before trusting this project status for new work.",
      priority: "important",
      source: "runtime",
    }
  }

  return null
}

export async function writeProjectRuntimeState(developerPath: string, projectName: string, state: ProjectRuntimeState) {
  assertManagedRuntimeConfigured()
  const [existing] = await selectRows<RuntimeStateProjectRow>("projects", {
    select: "id,name,current_run_id,runtime_status,runtime_summary,current_stage,governance_updated,last_run_completed_at,metadata",
    filters: { name: projectName },
    limit: 1,
  })
  const update = runtimeStateToProjectUpdate(state, existing?.metadata)

  await upsertRows(
    "projects",
    [
      {
        name: projectName,
        display_name: projectName
          .split(/[-_]/g)
          .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
          .join(" "),
        repo_path: resolveProjectDir(developerPath, projectName),
        is_self_managed: projectName === COMMAND_CENTER_PROJECT,
        ...update,
      },
    ],
    "name",
  )

  return `supabase://projects/${projectName}/runtime-state`
}

export async function launchJob(params: {
  developerPath: string
  type: JobType
  runTemplate?: ProjectRunTemplate | null
  projectName: string | null
  chatThreadId?: string | null
  instruction: string
  successCriteria?: string[]
  governanceTargets?: string[]
}) {
  const {
    developerPath,
    type,
    projectName,
    chatThreadId = null,
    instruction,
    runTemplate = null,
    successCriteria = [],
    governanceTargets = [],
  } = params
  const activeJobs = await getActiveJobs(developerPath, projectName ?? undefined)
  if (activeJobs.length) {
    throw new Error("A worker is already active for this scope. Wait for it to finish before starting another one.")
  }

  const workingDirectory =
    type === "project_task"
      ? resolveProjectDir(developerPath, projectName as string)
      : type === "system_task"
        ? resolveProjectDir(developerPath, COMMAND_CENTER_PROJECT)
        : path.join(developerPath, "_system", "orchestrator")

  await fs.access(workingDirectory)
  assertManagedRuntimeConfigured()

  if (type === "project_task" && runTemplate === "continue_project" && projectName) {
    const run = await createContinueProjectRun({
      projectName,
      chatThreadId,
      instruction: instruction.trim(),
      successCriteria,
      governanceTargets,
    })
    const job = (await listInngestRuns(projectName)).find((item) => item.id === run.id)
    if (!job) {
      throw new Error("Failed to materialize the Inngest-backed run.")
    }

    await inngest.send({
      name: CONTINUE_PROJECT_EVENT,
      data: {
        runId: run.id,
      },
    })

    await recordRuntimeEvent({
      eventType: "run_launched",
      title: `${projectName} worker launched`,
      body: job.instruction,
      projectName,
      chatThreadId,
      reason: "launch",
      job,
      payload: {
        instruction: job.instruction,
        engine: "inngest",
      },
    }).catch(() => null)

    return job
  }

  if (type === "project_task" && projectName && runTemplate && runTemplate !== "continue_project" && runTemplate !== "investigate_issue") {
    const run = await createProjectTaskRun({
      projectName,
      chatThreadId,
      runTemplate,
      instruction: instruction.trim(),
      successCriteria,
      governanceTargets,
    })
    const job = (await listInngestRuns(projectName)).find((item) => item.id === run.id)
    if (!job) {
      throw new Error("Failed to materialize the Inngest-backed run.")
    }

    await inngest.send({
      name: PROJECT_TASK_EVENT,
      data: {
        runId: run.id,
      },
    })

    await recordRuntimeEvent({
      eventType: "run_launched",
      title: `${projectName} worker launched`,
      body: job.instruction,
      projectName,
      chatThreadId,
      reason: "launch",
      job,
      payload: {
        instruction: job.instruction,
        engine: "inngest",
      },
    }).catch(() => null)

    return job
  }

  if (type === "project_task" && projectName && runTemplate === "investigate_issue") {
    const run = await createProjectTaskRun({
      projectName,
      chatThreadId,
      runTemplate,
      instruction: instruction.trim(),
      successCriteria,
      governanceTargets,
    })
    const job = (await listInngestRuns(projectName)).find((item) => item.id === run.id)
    if (!job) {
      throw new Error("Failed to materialize the Inngest-backed run.")
    }

    await inngest.send({
      name: INVESTIGATE_PROJECT_EVENT,
      data: {
        runId: run.id,
      },
    })

    await recordRuntimeEvent({
      eventType: "run_launched",
      title: `${projectName} worker launched`,
      body: job.instruction,
      projectName,
      chatThreadId,
      reason: "launch",
      job,
      payload: {
        instruction: job.instruction,
        engine: "inngest",
      },
    }).catch(() => null)

    return job
  }

  if (type === "orchestrator_run") {
    const workingDirectory = path.join(developerPath, "_system", "orchestrator")
    const run = await createOrchestratorRun({
      instruction: instruction.trim(),
      workingDirectory,
    })
    const job = (await listInngestRuns()).find((item) => item.id === run.id)
    if (!job) {
      throw new Error("Failed to materialize the Inngest-backed run.")
    }

    await inngest.send({
      name: ORCHESTRATOR_RUN_EVENT,
      data: {
        runId: run.id,
      },
    })

    await recordRuntimeEvent({
      eventType: "run_launched",
      title: "Orchestrator run launched",
      body: job.instruction,
      projectName: COMMAND_CENTER_PROJECT,
      scope: "system",
      reason: "launch",
      job: {
        ...job,
        projectName: null,
      },
      payload: {
        instruction: job.instruction,
        engine: "inngest",
        projectName: null,
      },
    }).catch(() => null)

    return {
      ...job,
      projectName: null,
    }
  }

  throw new Error(`Unsupported managed run launch: ${type}${runTemplate ? ` (${runTemplate})` : ""}.`)
}

export async function cancelJob(developerPath: string, jobId: string): Promise<RuntimeJob> {
  assertManagedRuntimeConfigured()
  const inngestRun = await readInngestManagedRun(jobId).catch(() => null)
  if (!inngestRun) {
    throw new Error(`Managed run ${jobId} was not found.`)
  }

  const metadata = (inngestRun.metadata ?? {}) as Record<string, unknown>
  const projectName = typeof metadata.projectName === "string" ? metadata.projectName : null
  if (inngestRun.status !== "queued" && inngestRun.status !== "running") {
    throw new Error(`Managed run ${jobId} is already ${inngestRun.status}.`)
  }

  const cancelledAt = new Date().toISOString()
  const activeProcessPid = typeof metadata.activeProcessPid === "number" ? metadata.activeProcessPid : null
  if (activeProcessPid) {
    try {
      process.kill(activeProcessPid, "SIGTERM")
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : null
      if (code !== "ESRCH") {
        throw error
      }
    }
  }

  const updated = await updateRunRecord(jobId, {
    status: "cancelled",
    current_stage: "blocked",
    summary: "Worker was cancelled by the operator.",
    completed_at: cancelledAt,
    metadata: {
      cancelRequestedAt: cancelledAt,
      stageUpdatedAt: cancelledAt,
      activeProcessPid: null,
      exitCode: 130,
    },
  })

  const directJob = mapSupabaseRunToRuntimeJob(updated)
  const job: RuntimeJob = projectName ? directJob : { ...directJob, projectName: null }

  if (projectName) {
    const runtimeState: ProjectRuntimeState = {
      projectName,
      jobId: updated.id,
      runTemplate: (updated.run_template as ProjectRunTemplate) ?? null,
      status: "cancelled",
      summary: updated.summary ?? "Worker was cancelled by the operator.",
      configBlocker:
        metadata.configBlocker && typeof metadata.configBlocker === "object"
          ? (metadata.configBlocker as ProjectRuntimeState["configBlocker"])
          : null,
      governanceUpdated: false,
      governanceTargets: Array.isArray(metadata.governanceTargets) ? (metadata.governanceTargets as string[]) : [],
      updatedTargets: [],
      missingTargets: [],
      completedAt: updated.completed_at,
      messagePreview: updated.summary ?? "Worker was cancelled by the operator.",
      currentStage: "blocked",
      stageUpdatedAt: cancelledAt,
    }

    await writeProjectRuntimeState(developerPath, projectName, runtimeState)
    await recordProjectRuntimeUpdated({
      projectName,
      chatThreadId: job.chatThreadId ?? null,
      summary: runtimeState.summary,
      reason: "job_update",
      job,
      payload: {
        status: "cancelled",
      },
    }).catch(() => null)
  }

  await recordRuntimeEvent({
    eventType: "run_blocked",
    title: `${projectName ?? "System"} run cancelled`,
    body: updated.summary ?? "Worker was cancelled by the operator.",
    projectName: projectName ?? COMMAND_CENTER_PROJECT,
    chatThreadId: job.chatThreadId ?? null,
    scope: projectName ? "project" : "system",
    reason: "job_update",
    job: projectName ? job : { ...job, projectName: null },
    payload: {
      cancelled: true,
      projectName,
    },
  }).catch(() => null)

  return job
}

export async function retryJob(developerPath: string, jobId: string): Promise<RuntimeJob> {
  assertManagedRuntimeConfigured()
  const inngestRun = await readInngestManagedRun(jobId).catch(() => null)
  if (!inngestRun) {
    throw new Error(`Managed run ${jobId} was not found.`)
  }

  const metadata = (inngestRun.metadata ?? {}) as Record<string, unknown>
  const jobType = metadata.jobType === "orchestrator_run" ? "orchestrator_run" : "project_task"

  return launchJob({
    developerPath,
    type: jobType,
    runTemplate: jobType === "project_task" ? ((inngestRun.run_template as ProjectRunTemplate) ?? "continue_project") : null,
    projectName: jobType === "project_task" && typeof metadata.projectName === "string" ? metadata.projectName : null,
    chatThreadId: typeof metadata.chatThreadId === "string" ? metadata.chatThreadId : null,
    instruction: inngestRun.instruction,
    successCriteria: Array.isArray(metadata.successCriteria) ? (metadata.successCriteria as string[]) : [],
    governanceTargets: Array.isArray(metadata.governanceTargets) ? (metadata.governanceTargets as string[]) : [],
  })
}

export function buildProjectRunSpec(projectName: string, template: ProjectRunTemplate, customInstruction?: string): ProjectRunSpec {
  const selfProject = projectName === COMMAND_CENTER_PROJECT
  const systemTargets = selfProject ? ["TASKS.md", "HANDOFF.md", "SYSTEM_IMPROVEMENTS.md"] : ["TASKS.md", "HANDOFF.md"]
  const blockerTargets = selfProject
    ? ["TASKS.md", "ERRORS.md", "HANDOFF.md", "SYSTEM_IMPROVEMENTS.md"]
    : ["TASKS.md", "ERRORS.md", "HANDOFF.md"]
  const qaTargets = selfProject
    ? ["QA_CHECKLIST.md", "SECURITY_CHECKLIST.md", "TASKS.md", "HANDOFF.md", "SYSTEM_IMPROVEMENTS.md"]
    : ["QA_CHECKLIST.md", "SECURITY_CHECKLIST.md", "TASKS.md", "HANDOFF.md"]

  if (template === "continue_project") {
    return {
      template,
      label: "Continue project",
      instruction:
        customInstruction?.trim() ||
        `Continue ${projectName} using TASKS.md and the latest HANDOFF.md. Complete the highest-priority in-progress or up-next task, verify what changed, and update governance files to match the real outcome.`,
      successCriteria: [
        "The highest-priority scoped task is advanced or completed.",
        "The worker verifies the result with a concrete command or inspection step.",
        "TASKS.md and HANDOFF.md reflect the real outcome.",
      ],
      governanceTargets: systemTargets,
    }
  }

  if (template === "fix_blocker") {
    return {
      template,
      label: "Fix blocker",
      instruction:
        `Investigate the top blocker in ${projectName}, implement the narrowest safe fix you can justify, verify it, and update TASKS.md, ERRORS.md, and HANDOFF.md to reflect the result.`,
      successCriteria: [
        "The named blocker is investigated with evidence.",
        "If a safe fix is available, it is implemented and verified.",
        "If not fixable, the blocker is escalated clearly with specific next steps.",
      ],
      governanceTargets: blockerTargets,
    }
  }

  if (template === "fix_issue") {
    return {
      template,
      label: "Fix issue",
      instruction:
        `Fix the confirmed issue in ${projectName}. Start from TASKS.md, HANDOFF.md, ERRORS.md, and any active investigation evidence. Make the required code changes, verify the fix with concrete evidence, commit the changes, and update TASKS.md, ERRORS.md, and HANDOFF.md to reflect the real outcome.`,
      successCriteria: [
        "The worker makes the required code changes instead of only restating the investigation.",
        "The fix is verified with a concrete command, inspection step, or direct evidence check.",
        "The worker creates a git commit and records the real outcome in governance files.",
      ],
      governanceTargets: blockerTargets,
    }
  }

  if (template === "review_next_move") {
    return {
      template,
      label: "Review next move",
      instruction:
        `Review ${projectName}, identify the highest-priority next move, avoid unnecessary code edits, and update TASKS.md plus HANDOFF.md so the next session can continue cleanly.`,
      successCriteria: [
        "The next highest-value task is explicitly identified.",
        "The recommendation is backed by the current repo and governance state.",
        "TASKS.md and HANDOFF.md are ready for the next agent session.",
      ],
      governanceTargets: systemTargets,
    }
  }

  if (template === "prep_qa") {
    return {
      template,
      label: "Prep QA",
      instruction:
        `Prepare ${projectName} for QA by reviewing implementation readiness, identifying missing verification steps, and updating QA_CHECKLIST.md, SECURITY_CHECKLIST.md, TASKS.md, and HANDOFF.md with the current state.`,
      successCriteria: [
        "Readiness gaps are identified concretely.",
        "QA and security checklists reflect the current reality.",
        "The next verification step is explicit.",
      ],
      governanceTargets: qaTargets,
    }
  }

  if (template === "investigate_issue") {
    return {
      template,
      label: "Investigate issue",
      instruction:
        `Investigate the highest-priority trust gap or blocker in ${projectName}. Check the relevant local repo state, runtime logs, and external integration evidence if available. Identify the most likely cause, propose the exact next fix, apply a low-risk fix yourself if it is clearly safe, verify the result, and update TASKS.md, ERRORS.md, and HANDOFF.md to match reality.`,
      successCriteria: [
        "The system names what it checked and what evidence it found.",
        "The most likely cause is stated plainly, with the exact next fix.",
        "If a low-risk fix is available, it is attempted and verified; otherwise the blocker is escalated with evidence.",
      ],
      governanceTargets: blockerTargets,
    }
  }

  return {
    template: "custom",
    label: "Custom worker",
    instruction: customInstruction?.trim() || `Continue ${projectName} with the provided instruction and update governance files as needed.`,
    successCriteria: [
      "The instruction is completed or clearly bounded.",
      "The worker verifies what it changed or why it stopped.",
      "Relevant governance files are updated if the state changed.",
    ],
    governanceTargets: systemTargets,
  }
}
