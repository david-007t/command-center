import { promises as fs } from "fs"
import path from "path"
import { NextResponse } from "next/server"
import { deriveInvestigationAutonomy } from "@/lib/command-center-guardrails"
import { getPortfolioPath, readPortfolioProjectsWithCommandCenter, resolveProjectDir } from "@/lib/managed-projects"
import { getActiveJobs, getDeveloperPath, readProjectRuntimeState, type CeoDecision } from "@/lib/orchestration"
import { ensureProjectContextPack } from "@/lib/project-context-pack"
import { listFeedbackRecords } from "@/lib/feedback"
import { getProjectStatus } from "@/lib/project-status"
import { readPortfolioFromStore } from "@/lib/runtime-store/phase1-store"
import { recordRuntimeEvent } from "@/lib/runtime-events"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { syncSystemImprovements } from "@/lib/system-improvements"
import { summarizeUsage } from "@/lib/usage-telemetry"
import {
  executiveDecisionFromPortfolio,
  executiveDecisionFromRuntime,
  executiveStatusLabel,
  executiveizeBlocker,
  executiveizeHandoff,
  executiveizeNextAction,
  executiveRuntimeSummary,
} from "@/lib/executive"

type ProjectRecord = {
  name: string
  phase: string
  progress: number
  blocker: string
  nextAction: string
  launchTarget: string
  latestHandoff: string
  runtimeState: {
    status: string
    statusLabel: string
    summary: string
    currentStage?: string | null
    trust?: {
      level: string
      headline: string
      checks?: Array<{
        label: string
        status: string
        source: string
        detail: string
      }>
      }
  } | null
  contextHealth?: {
    freshness: string
    health: string
    approximateTokens: number
    compressionRatio?: number
    compactionRecommendedAction?: string
  } | null
  investigation?: {
    title: string
    summary: string
    likelyCause: string
    nextStep: string
    canAutofix: boolean
    status?: string
    autonomyMode?: string
    autonomyRationale?: string
  } | null
}

type PortfolioDecision = CeoDecision & {
  projectName: string
}

function parsePortfolio(markdown: string) {
  const queueSection = markdown.match(/## Build queue([\s\S]*?)(\n## |$)/)?.[1] ?? ""
  const pendingSection = markdown.match(/## Pending CEO decisions([\s\S]*?)(\n## |$)/)?.[1] ?? ""
  const scoutSection = markdown.match(/## Scout summary([\s\S]*?)(\n## |$)/)?.[1]?.trim() ?? "No scout report yet."
  const health = markdown.match(/## System health([\s\S]*?)(\n## |$)/)?.[1] ?? ""

  return {
    projects: [] as ProjectRecord[],
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

function executiveSummaryFromHandoff(handoff: string) {
  const working = handoff.match(/## What is working([\s\S]*?)(\n## |$)/)?.[1]?.trim()
  const next = handoff
    .match(/## What the next agent should do first([\s\S]*?)(\n## |$)/)?.[1]
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => /^\d+\./.test(line))
    ?.replace(/^\d+\.\s*/, "")

  return executiveizeHandoff(working?.split("\n").find(Boolean)?.trim() || next || "No executive summary recorded.")
}

async function readLatestHandoff(developerPath: string, projectName: string) {
  const handoffPath = path.join(resolveProjectDir(developerPath, projectName), "HANDOFF.md")
  const handoff = await fs.readFile(handoffPath, "utf8").catch(() => "")
  return executiveSummaryFromHandoff(handoff)
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

export async function GET() {
  if (isSupabaseConfigured()) {
    const stored = await readPortfolioFromStore().catch(() => null)
    if (stored) {
      return NextResponse.json(stored)
    }
  }

  const developerPath = getDeveloperPath()

  const portfolioMarkdown = await fs.readFile(getPortfolioPath(developerPath), "utf8").catch(() => "")
  const parsed = parsePortfolio(portfolioMarkdown)
  parsed.projects = (await readPortfolioProjectsWithCommandCenter(developerPath, portfolioMarkdown)).map((project) => ({
    ...project,
    latestHandoff: "",
    runtimeState: null,
  }))
  await syncSystemImprovements(developerPath).catch(() => null)
  const recentFeedback = await listFeedbackRecords(developerPath, 6)
  const usageSummary = await summarizeUsage(developerPath)

  const projects = await Promise.all(
    parsed.projects.map(async (project) => {
      const detailed = await getProjectStatus(project.name).catch(() => null)
      const contextPack = await ensureProjectContextPack(developerPath, project.name).catch(() => null)
      const autonomy = detailed?.investigation
        ? deriveInvestigationAutonomy({
            canAutofix: detailed.investigation.canAutofix,
            contextHealth: contextPack?.health ?? null,
            usageStatus: usageSummary.guardrails.overallStatus,
          })
        : null
      return {
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
    }),
  )
  const activeRuns = await getActiveJobs(developerPath)
  const runtimeStates = await Promise.all(
    parsed.projects.map(async (project) => ({
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

  const activeBuildSlot = projects.reduce(
    (best, project) => (project.progress > best.progress ? project : best),
    projects[0] ?? {
      name: "No active build",
      phase: "PARKED",
      progress: 0,
      blocker: "None",
      nextAction: "Create a project",
      launchTarget: "TBD",
      latestHandoff: "No handoff yet.",
    },
  )
  return NextResponse.json({
    activeBuildSlot: {
      projectName: activeBuildSlot.name,
      phase: activeBuildSlot.phase,
      progress: activeBuildSlot.progress,
      lastSession: activeBuildSlot.latestHandoff || "No session recorded.",
      nextAction: activeBuildSlot.nextAction,
      blockers: activeBuildSlot.blocker,
    },
    projects,
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
  })
}

export async function POST(request: Request) {
  const developerPath = process.env.DEVELOPER_PATH
  if (!developerPath) {
    return NextResponse.json({ error: "DEVELOPER_PATH is not configured." }, { status: 500 })
  }

  const { projectName, action, reason } = await request.json()
  const portfolioPath = getPortfolioPath(developerPath)
  let portfolio = await fs.readFile(portfolioPath, "utf8")

  if (action === "ship") {
    portfolio = portfolio.replace(
      new RegExp(`\\| ${projectName} \\| ([^|]+) \\|`, "g"),
      `| ${projectName} | SHIP |`,
    )
  }

  if (action === "rebuild") {
    portfolio = portfolio.replace(
      new RegExp(`\\| ${projectName} \\| ([^|]+) \\|`, "g"),
      `| ${projectName} | BUILD |`,
    )

    const tasksPath = path.join(developerPath, projectName, "TASKS.md")
    const tasks = await fs.readFile(tasksPath, "utf8").catch(() => "")
    const appended = `${tasks}\n\n- [ ] CEO sent build back on 2026-04-14 — reason: ${reason}\n`
    await fs.writeFile(tasksPath, appended, "utf8")
  }

  await fs.writeFile(portfolioPath, portfolio, "utf8")
  await recordRuntimeEvent({
    eventType: "project_runtime_updated",
    projectName,
    scope: "portfolio",
    reason: "portfolio_update",
    title: action === "ship" ? "Portfolio updated for ship approval" : "Portfolio sent back to build",
    body: action === "ship" ? `${projectName} moved to SHIP.` : `${projectName} moved back to BUILD. ${reason ?? ""}`.trim(),
    payload: {
      action,
      reason: reason ?? null,
    },
  }).catch(() => null)
  return NextResponse.json({ message: `${projectName} updated.` })
}
