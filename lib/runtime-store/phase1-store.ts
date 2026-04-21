import { promises as fs } from "fs"
import path from "path"
import { deriveInvestigationAutonomy } from "@/lib/command-center-guardrails"
import { listFeedbackRecords } from "@/lib/feedback"
import { COMMAND_CENTER_PROJECT, getPortfolioPath, readPortfolioProjectsWithCommandCenter, resolveProjectDir } from "@/lib/managed-projects"
import { getActiveJobs, getDeveloperPath, readProjectRuntimeState, type CeoDecision } from "@/lib/orchestration"
import { ensureProjectContextPack } from "@/lib/project-context-pack"
import { getProjectStatus } from "@/lib/project-status"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { deleteRows, insertRows, selectRows, upsertRows } from "@/lib/supabase/rest"
import { syncSystemImprovements } from "@/lib/system-improvements"
import { summarizeUsage } from "@/lib/usage-telemetry"
import {
  buildPortfolioResponseFromStore,
  mergeThreadMessagesPreservingRunEvents,
  projectRowToPageData,
  projectRowToProjectStatus,
  type Phase1DashboardSnapshot,
  type Phase1ProjectRow,
} from "./phase1-serialization"
import type { ChatThreadMessage } from "../chat-thread-messages"
import { executiveDecisionFromPortfolio, executiveDecisionFromRuntime, executiveStatusLabel, executiveizeBlocker, executiveizeHandoff, executiveizeNextAction, executiveRuntimeSummary } from "../executive"

type PortfolioDecision = CeoDecision & {
  projectName: string
}

type ThreadRow = {
  id: string
  project_id: string
  external_thread_key: string | null
  last_message_at: string | null
  updated_at: string
}

type MessageRow = {
  id: string
  thread_id: string
  role: "user" | "assistant" | "system"
  source: "chat" | "run_event" | "system_notice"
  content: string
  structured_content: {
    id?: string
    jobId?: string
    updatedAt?: string
  }
  created_at: string
}

let seedPromise: Promise<void> | null = null

function parsePortfolio(markdown: string) {
  const queueSection = markdown.match(/## Build queue([\s\S]*?)(\n## |$)/)?.[1] ?? ""
  const pendingSection = markdown.match(/## Pending CEO decisions([\s\S]*?)(\n## |$)/)?.[1] ?? ""
  const scoutSection = markdown.match(/## Scout summary([\s\S]*?)(\n## |$)/)?.[1]?.trim() ?? "No scout report yet."
  const health = markdown.match(/## System health([\s\S]*?)(\n## |$)/)?.[1] ?? ""

  return {
    buildQueue: queueSection
      .split("\n")
      .filter((line) => line.trim().startsWith("- "))
      .map((line) => line.replace(/^- /, "").trim()),
    pendingDecisions: pendingSection
      .split("\n")
      .filter((line) => line.trim().startsWith("- "))
      .map((line) => line.replace(/^- /, "").trim()),
    scoutSummary: scoutSection,
    systemHealth: {
      orchestratorLastActive: health.match(/- Orchestrator last active: (.*)/)?.[1] ?? "Not run yet",
      templatesVersion: health.match(/- Templates version: (.*)/)?.[1] ?? "1.0",
      productsShipped: Number(health.match(/- Products shipped: (.*)/)?.[1] ?? "0"),
    },
  }
}

function parsePortfolioDecision(entry: string): PortfolioDecision | null {
  const [projectName, remainder] = entry.split(":")
  if (!projectName || !remainder) return null

  return {
    ...executiveDecisionFromPortfolio(projectName.trim(), remainder.trim()),
    priority: "important",
    source: "portfolio",
  }
}

function toDisplayName(projectName: string) {
  return projectName
    .split(/[-_]/g)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")
}

async function readLatestHandoff(developerPath: string, projectName: string) {
  const handoffPath = path.join(resolveProjectDir(developerPath, projectName), "HANDOFF.md")
  const handoff = await fs.readFile(handoffPath, "utf8").catch(() => "")
  const working = handoff.match(/## What is working([\s\S]*?)(\n## |$)/)?.[1]?.trim()
  const next = handoff
    .match(/## What the next agent should do first([\s\S]*?)(\n## |$)/)?.[1]
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => /^\d+\./.test(line))
    ?.replace(/^\d+\.\s*/, "")

  return executiveizeHandoff(working?.split("\n").find(Boolean)?.trim() || next || "No executive summary recorded.")
}

async function seedProjectsFromFilesystem(developerPath: string) {
  const portfolioMarkdown = await fs.readFile(getPortfolioPath(developerPath), "utf8").catch(() => "")
  const parsed = parsePortfolio(portfolioMarkdown)
  const portfolioProjects = await readPortfolioProjectsWithCommandCenter(developerPath, portfolioMarkdown)

  await syncSystemImprovements(developerPath).catch(() => null)
  const recentFeedback = await listFeedbackRecords(developerPath, 6)
  const usageSummary = await summarizeUsage(developerPath)

  const projectSnapshots = await Promise.all(
    portfolioProjects.map(async (project) => {
      const detailed = await getProjectStatus(project.name).catch(() => null)
      const contextPack = await ensureProjectContextPack(developerPath, project.name).catch(() => null)
      const autonomy = detailed?.investigation
        ? deriveInvestigationAutonomy({
            canAutofix: detailed.investigation.canAutofix,
            contextHealth: contextPack?.health ?? null,
            usageStatus: usageSummary.guardrails.overallStatus,
          })
        : null

      const portfolioProject = {
        ...project,
        latestHandoff: detailed?.latestHandoff.whatWorks || (await readLatestHandoff(developerPath, project.name)),
        runtimeState: detailed?.runtimeState
          ? {
              status: detailed.runtimeState.status,
              statusLabel: detailed.runtimeState.statusLabel,
              summary: detailed.runtimeState.summary,
              currentStage: detailed.runtimeState.currentStage,
              trust: {
                level: detailed.runtimeState.trust.level,
                headline: detailed.runtimeState.trust.headline,
                checks: detailed.runtimeState.trust.checks,
              },
            }
          : await readProjectRuntimeState(developerPath, project.name).then((state) =>
              state
                ? {
                    status: state.status,
                    statusLabel: executiveStatusLabel(state.status),
                    summary: executiveRuntimeSummary(state),
                    currentStage: state.currentStage,
                  }
                : null,
            ),
        investigation: detailed?.investigation
          ? {
              title: detailed.investigation.title,
              summary: detailed.investigation.summary,
              likelyCause: detailed.investigation.likelyCause,
              nextStep: detailed.investigation.nextStep,
              canAutofix: detailed.investigation.canAutofix,
              status: detailed.investigation.status,
              autonomyMode: autonomy?.mode,
              autonomyRationale: autonomy?.rationale,
            }
          : null,
        contextHealth: contextPack
          ? {
              freshness: contextPack.freshness,
              health: contextPack.health,
              approximateTokens: contextPack.approximateTokens,
              compressionRatio: contextPack.compressionRatio,
              compactionRecommendedAction: contextPack.compactionRecommendedAction,
            }
          : null,
        blocker: executiveizeBlocker(project.blocker),
        nextAction: executiveizeNextAction(project.nextAction),
      }

      const projectStatus = detailed
        ? detailed.investigation
          ? {
              ...detailed,
              investigation: {
                ...detailed.investigation,
                autonomyMode: autonomy?.mode,
                autonomyRationale: autonomy?.rationale,
              },
            }
          : detailed
        : null

      return {
        project,
        portfolioProject,
        projectStatus,
        contextPack,
      }
    }),
  )

  const activeRuns = await getActiveJobs(developerPath)
  const runtimeStates = await Promise.all(
    portfolioProjects.map(async (project) => ({
      projectName: project.name,
      runtimeState: await readProjectRuntimeState(developerPath, project.name),
    })),
  )
  const runtimeDecisions: PortfolioDecision[] = runtimeStates.flatMap(({ projectName, runtimeState }) =>
    runtimeState
      ? (() => {
          const decision = executiveDecisionFromRuntime(projectName, runtimeState)
          return decision
            ? [
                {
                  ...decision,
                  priority: "critical" as const,
                  source: "runtime" as const,
                },
              ]
            : []
        })()
      : [],
  )
  const portfolioDecisions: PortfolioDecision[] = parsed.pendingDecisions.flatMap((entry) => {
    const decision = parsePortfolioDecision(entry)
    return decision ? [decision] : []
  })
  const decisionItems = [...runtimeDecisions, ...portfolioDecisions].sort((left, right) =>
    left.priority === right.priority ? left.projectName.localeCompare(right.projectName) : left.priority === "critical" ? -1 : 1,
  )
  const bestProject =
    projectSnapshots.reduce((best, current) => (current.project.progress > best.project.progress ? current : best), projectSnapshots[0]!) ??
    null

  const dashboard: Phase1DashboardSnapshot = {
    activeBuildSlot: bestProject
      ? {
          projectName: bestProject.project.name,
          phase: bestProject.project.phase,
          progress: bestProject.project.progress,
          lastSession: bestProject.portfolioProject.latestHandoff || "No session recorded.",
          nextAction: bestProject.portfolioProject.nextAction,
          blockers: bestProject.portfolioProject.blocker,
        }
      : {
          projectName: "No active build",
          phase: "PARKED",
          progress: 0,
          lastSession: "No session recorded.",
          nextAction: "Load Postgres runtime state",
          blockers: "None",
        },
    buildQueue: parsed.buildQueue,
    pendingDecisions: parsed.pendingDecisions,
    decisionItems,
    usageSummary,
    scoutSummary: parsed.scoutSummary,
    systemHealth: parsed.systemHealth,
    recentFeedback: recentFeedback.map((item) => ({
      id: item.id,
      scopeLabel: item.scope === "system" ? "Command Center" : item.projectName ?? "Project",
      statusLabel:
        item.status === "actioning"
          ? "In progress"
          : item.status === "resolved"
            ? "Resolved"
            : item.status === "needs_decision"
              ? "Needs your decision"
              : "Logged",
      summary: item.summary,
      resolutionNote: item.resolutionNote,
    })),
    activeRuns: activeRuns.map((job) => ({
      id: job.id,
      projectName: job.projectName,
      status: job.status,
      statusLabel: executiveStatusLabel(job.status),
      instruction: job.instruction,
      createdAt: job.createdAt,
      summary: job.summary,
      currentStage: job.currentStage,
    })),
  }

  await upsertRows(
    "projects",
    projectSnapshots.map(({ project, portfolioProject, projectStatus, contextPack }) => ({
      name: project.name,
      display_name: toDisplayName(project.name),
      repo_path: resolveProjectDir(developerPath, project.name),
      is_self_managed: project.name === COMMAND_CENTER_PROJECT,
      phase: portfolioProject.phase,
      progress: portfolioProject.progress,
      launch_target: portfolioProject.launchTarget,
      runtime_status: portfolioProject.runtimeState?.status ?? null,
      runtime_summary: portfolioProject.runtimeState?.summary ?? null,
      current_stage: portfolioProject.runtimeState?.currentStage ?? null,
      blocked_reason: portfolioProject.blocker || null,
      governance_updated: Boolean(projectStatus?.runtimeState && "governanceUpdated" in projectStatus.runtimeState ? projectStatus.runtimeState.governanceUpdated : false),
      last_run_completed_at:
        projectStatus?.runtimeState && "completedAt" in projectStatus.runtimeState ? (projectStatus.runtimeState.completedAt as string | null) : null,
      last_event_at: new Date().toISOString(),
      metadata: {
        phase1: {
          portfolioProject,
          projectStatus,
          contextPack,
          usageSummary,
          ...(project.name === COMMAND_CENTER_PROJECT ? { dashboard } : {}),
        },
      },
    })),
    "name",
  )
}

export async function ensurePhase1StoreSeeded(developerPath = getDeveloperPath()) {
  if (!isSupabaseConfigured()) return false

  const existing = await selectRows<Phase1ProjectRow>("projects", {
    select: "id,name,display_name,metadata",
    limit: 1,
  })
  if (existing.length > 0) return true

  if (!seedPromise) {
    seedPromise = seedProjectsFromFilesystem(developerPath).finally(() => {
      seedPromise = null
    })
  }

  await seedPromise
  return true
}

export async function readPortfolioFromStore(developerPath = getDeveloperPath()) {
  await ensurePhase1StoreSeeded(developerPath)
  const rows = await selectRows<Phase1ProjectRow>("projects", {
    select: "id,name,display_name,metadata",
    order: "created_at.asc",
  })
  return buildPortfolioResponseFromStore(rows)
}

export async function readProjectStatusFromStore(projectName: string, developerPath = getDeveloperPath()) {
  await ensurePhase1StoreSeeded(developerPath)
  const [row] = await selectRows<Phase1ProjectRow>("projects", {
    select: "id,name,display_name,metadata",
    filters: { name: projectName },
    limit: 1,
  })

  if (!row) return null

  const fresh = await getProjectStatus(projectName).catch(() => null)
  return fresh ?? projectRowToProjectStatus(row)
}

export async function readProjectPageDataFromStore(projectName: string, developerPath = getDeveloperPath()) {
  await ensurePhase1StoreSeeded(developerPath)
  const [row] = await selectRows<Phase1ProjectRow>("projects", {
    select: "id,name,display_name,metadata",
    filters: { name: projectName },
    limit: 1,
  })

  if (!row) return null

  const stored = projectRowToPageData(row)
  const freshProjectStatus = await getProjectStatus(projectName).catch(() => null)

  return {
    ...stored,
    projectStatus: freshProjectStatus ?? stored.projectStatus,
  }
}

async function getProjectRow(projectName: string, developerPath = getDeveloperPath()) {
  await ensurePhase1StoreSeeded(developerPath)
  let [row] = await selectRows<Phase1ProjectRow>("projects", {
    select: "id,name,display_name,metadata",
    filters: { name: projectName },
    limit: 1,
  })

  if (!row) {
    const [created] = await upsertRows<Phase1ProjectRow>(
      "projects",
      [
        {
          name: projectName,
          display_name: toDisplayName(projectName),
          repo_path: resolveProjectDir(developerPath, projectName),
          is_self_managed: projectName === COMMAND_CENTER_PROJECT,
          metadata: {
            phase1: {
              portfolioProject: {
                name: projectName,
                phase: "BUILD",
                progress: 0,
                blocker: "Not seeded yet",
                nextAction: "Seed runtime store",
                launchTarget: "TBD",
                latestHandoff: "No handoff recorded.",
                runtimeState: null,
              },
            },
          },
        },
      ],
      "name",
    )
    row = created
  }

  return row
}

function mapMessageRow(row: MessageRow): ChatThreadMessage {
  return {
    id: row.structured_content?.id ?? row.id,
    role: row.role === "system" ? "assistant" : row.role,
    content: row.content,
    source: row.source === "system_notice" ? "chat" : row.source,
    jobId: row.structured_content?.jobId,
    updatedAt: row.structured_content?.updatedAt,
  }
}

async function getThreadMessages(threadId: string) {
  const rows = await selectRows<MessageRow>("messages", {
    select: "id,thread_id,role,source,content,structured_content,created_at",
    filters: { thread_id: threadId },
    order: "created_at.asc",
  })

  return rows.map(mapMessageRow)
}

export async function readChatThreadFromStore(projectName: string, threadId: string, developerPath = getDeveloperPath()) {
  const project = await getProjectRow(projectName, developerPath)
  const [thread] = await selectRows<ThreadRow>("threads", {
    select: "id,project_id,external_thread_key,last_message_at,updated_at",
    filters: {
      project_id: project.id,
      external_thread_key: threadId,
    },
    limit: 1,
  })

  if (!thread) return null

  return {
    projectName,
    threadId,
    updatedAt: thread.last_message_at ?? thread.updated_at,
    messages: await getThreadMessages(thread.id),
  }
}

export async function readLatestChatThreadFromStore(projectName: string, developerPath = getDeveloperPath()) {
  const project = await getProjectRow(projectName, developerPath)
  const [thread] = await selectRows<ThreadRow>("threads", {
    select: "id,project_id,external_thread_key,last_message_at,updated_at",
    filters: { project_id: project.id },
    order: "last_message_at.desc",
    limit: 1,
  })

  if (!thread || !thread.external_thread_key) return null

  return {
    projectName,
    threadId: thread.external_thread_key,
    updatedAt: thread.last_message_at ?? thread.updated_at,
    messages: await getThreadMessages(thread.id),
  }
}

export async function saveChatThreadToStore(
  projectName: string,
  threadId: string,
  messages: ChatThreadMessage[],
  developerPath = getDeveloperPath(),
) {
  const project = await getProjectRow(projectName, developerPath)
  const now = new Date().toISOString()
  const [thread] = await upsertRows<ThreadRow>(
    "threads",
    [
      {
        project_id: project.id,
        scope: "project",
        title: `${projectName} chat`,
        external_thread_key: threadId,
        last_message_at: now,
      },
    ],
    "project_id,external_thread_key",
  )

  const existing = await getThreadMessages(thread.id)
  const merged = mergeThreadMessagesPreservingRunEvents(existing, messages)

  await deleteRows("messages", { thread_id: thread.id })
  if (merged.length > 0) {
    await insertRows("messages", merged.map((message) => ({
      thread_id: thread.id,
      role: message.role,
      source: message.source,
      content: message.content,
      structured_content: {
        id: message.id,
        jobId: message.jobId ?? null,
        updatedAt: message.updatedAt ?? null,
      },
    })))
  }

  return {
    projectName,
    threadId,
    updatedAt: now,
    messages: merged,
  }
}
