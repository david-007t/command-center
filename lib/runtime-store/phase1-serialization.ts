import type { ChatThreadMessage } from "../chat-thread-messages"
import type { ProjectStatus } from "../project-status"
import type { ProjectReadiness } from "../project-readiness"

export type Phase1ProjectStatusSnapshot = ProjectStatus

export type Phase1PortfolioProjectSnapshot = {
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
  readiness?: ProjectReadiness | null
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

export type Phase1DashboardSnapshot = {
  activeBuildSlot: {
    projectName: string
    phase: string
    progress: number
    lastSession: string
    nextAction: string
    blockers: string
  }
  buildQueue: string[]
  pendingDecisions: string[]
  decisionItems: Array<{
    projectName: string
    title: string
    reason: string
    recommendation: string
    priority: "critical" | "important"
    source: "runtime" | "portfolio"
  }>
  usageSummary?: Record<string, unknown>
  scoutSummary: string
  systemHealth: {
    orchestratorLastActive: string
    templatesVersion: string
    productsShipped: number
  }
  recentFeedback?: Array<{
    id: string
    scopeLabel: string
    statusLabel: string
    summary: string
    resolutionNote: string | null
  }>
  activeRuns: Array<{
    id: string
    projectName: string | null
    status: string
    statusLabel: string
    instruction: string
    createdAt: string
    stageUpdatedAt?: string | null
    summary: string
    currentStage: string
  }>
}

export type Phase1ProjectMetadata = {
  phase1?: {
    portfolioProject?: Phase1PortfolioProjectSnapshot
    projectStatus?: Phase1ProjectStatusSnapshot
    contextPack?: Record<string, unknown> | null
    usageSummary?: Record<string, unknown> | null
    dashboard?: Phase1DashboardSnapshot
  }
}

export type Phase1ProjectRow = {
  id: string
  name: string
  display_name: string
  metadata: Phase1ProjectMetadata
}

function normalizeRuntimeStatus(status: string): NonNullable<ProjectStatus["runtimeState"]>["status"] {
  if (
    status === "healthy" ||
    status === "stale_governance" ||
    status === "awaiting_ceo" ||
    status === "blocked" ||
    status === "blocked_on_config" ||
    status === "cancelled"
  ) {
    return status
  }

  return "blocked"
}

function normalizeTrustLevel(level: string): NonNullable<ProjectStatus["runtimeState"]>["trust"]["level"] {
  if (level === "confirmed" || level === "inferred" || level === "unverified") {
    return level
  }

  return "unverified"
}

function normalizeTrustCheckStatus(status: string) {
  if (status === "confirmed" || status === "inferred" || status === "unverified") {
    return status
  }

  return "unverified"
}

function normalizeTrustCheckSource(source: string) {
  if (
    source === "local_repo" ||
    source === "worker_report" ||
    source === "governance" ||
    source === "external_deploy" ||
    source === "runtime_record"
  ) {
    return source
  }

  return "runtime_record"
}

function normalizeInvestigationStatus(status?: string) {
  if (status === "healthy" || status === "needs_attention" || status === "blocked") {
    return status
  }

  return "needs_attention"
}

function normalizeAutonomyMode(mode?: string) {
  if (mode === "can_autofix" || mode === "needs_review" || mode === "needs_ceo_approval") {
    return mode
  }

  return undefined
}

export function mergeThreadMessagesPreservingRunEvents(
  existing: ChatThreadMessage[],
  incoming: ChatThreadMessage[],
) {
  const knownRunEventJobIds = new Set(
    incoming.filter((message) => message.source === "run_event" && message.jobId).map((message) => message.jobId as string),
  )
  const preservedRunEvents = existing.filter(
    (message) => message.source === "run_event" && message.jobId && !knownRunEventJobIds.has(message.jobId),
  )

  return [...incoming, ...preservedRunEvents]
}

export function projectRowToProjectStatus(row: Phase1ProjectRow): ProjectStatus | null {
  const projectStatus = row.metadata.phase1?.projectStatus
  if (projectStatus) {
    return projectStatus
  }

  const project = row.metadata.phase1?.portfolioProject
  if (!project) {
    return null
  }

  const fallback: ProjectStatus = {
    name: project.name,
    phase: project.phase,
    blocker: project.blocker,
    progress: project.progress,
    nextAction: project.nextAction,
    launchTarget: project.launchTarget,
    sprintGoal: project.nextAction,
    inProgress: [],
    blockedItems: project.blocker && project.blocker !== "None" ? [project.blocker] : [],
    upNext: project.nextAction ? [project.nextAction] : [],
    latestHandoff: {
      whatWorks: project.latestHandoff || "No handoff summary is available in the cloud runtime.",
      whatIsBroken: project.blocker || "No blocker is currently recorded.",
      nextSteps: project.nextAction ? [project.nextAction] : [],
    },
    activeError: {
      description: project.blocker || "No active error is recorded.",
      impact: "Loaded from the cloud project record because local project files are not available.",
    },
    ceoDecision: null,
    recommendedAction: {
      template: "continue_project",
      label: "Continue project",
      reason: project.nextAction || "Continue from the cloud project record.",
    },
    operatingState: {
      status: project.phase.toLowerCase().includes("build") ? "building" : "ready",
      label: project.phase.toLowerCase().includes("build") ? "In build" : "Ready",
      summary: project.runtimeState?.summary || "Loaded from the cloud project record.",
      nextAction: project.nextAction || "Review the latest project state.",
      blocker: project.blocker || "None detected.",
      tone: project.blocker && project.blocker !== "None" ? "amber" : "green",
    },
    deploymentLinks: {
      production: null,
      stage: null,
    },
    runtimeState: project.runtimeState
      ? {
          projectName: project.name,
          jobId: "",
          runTemplate: null,
          status: normalizeRuntimeStatus(project.runtimeState.status),
          statusLabel: project.runtimeState.statusLabel,
          summary: project.runtimeState.summary,
          configBlocker: null,
          governanceUpdated: false,
          governanceTargets: [],
          updatedTargets: [],
          missingTargets: [],
          completedAt: null,
          messagePreview: project.runtimeState.summary,
          currentStage: project.runtimeState.currentStage ?? null,
          stageUpdatedAt: null,
          trust: project.runtimeState.trust
            ? {
                level: normalizeTrustLevel(project.runtimeState.trust.level),
                headline: project.runtimeState.trust.headline,
                checks: (project.runtimeState.trust.checks ?? []).map((check) => ({
                  label: check.label,
                  status: normalizeTrustCheckStatus(check.status),
                  source: normalizeTrustCheckSource(check.source),
                  detail: check.detail,
                })),
              }
            : {
                level: "unverified",
                headline: "This cloud fallback has not verified local evidence.",
                checks: [],
              },
        }
      : null,
    investigation: project.investigation
      ? {
          title: project.investigation.title,
          summary: project.investigation.summary,
          checks: [],
          likelyCause: project.investigation.likelyCause,
          nextStep: project.investigation.nextStep,
          canAutofix: project.investigation.canAutofix,
          suggestedTemplate: "investigate_issue",
          suggestedInstruction: project.investigation.nextStep,
          status: normalizeInvestigationStatus(project.investigation.status),
          autonomyMode: normalizeAutonomyMode(project.investigation.autonomyMode),
          autonomyRationale: project.investigation.autonomyRationale,
        }
      : null,
    freshness: {
      generatedAt: new Date().toISOString(),
      sources: {
        portfolio: { label: "Cloud project record", updatedAt: null },
        tasks: { label: "Unavailable in cloud runtime", updatedAt: null },
        handoff: { label: "Cloud project record", updatedAt: null },
        errors: { label: "Unavailable in cloud runtime", updatedAt: null },
        runtime: { label: "Cloud project record", updatedAt: null, jobId: null },
        jobs: { label: "Unavailable in cloud runtime", updatedAt: null, jobId: null },
        deploymentLinks: { label: "Unavailable in cloud runtime", updatedAt: null },
      },
    },
    jobs: [],
  }

  return fallback
}

export function projectRowToPageData(row: Phase1ProjectRow) {
  const projectStatus = projectRowToProjectStatus(row)

  return {
    projectStatus,
    contextPack: row.metadata.phase1?.contextPack ?? null,
    usageSummary: row.metadata.phase1?.usageSummary ?? null,
  }
}

export function buildPortfolioResponseFromStore(rows: Phase1ProjectRow[]) {
  const projectSnapshots = rows
    .map((row) => row.metadata.phase1?.portfolioProject)
    .filter((snapshot): snapshot is Phase1PortfolioProjectSnapshot => Boolean(snapshot))
  const commandCenter = rows.find((row) => row.name === "command-center")
  const dashboard = commandCenter?.metadata.phase1?.dashboard

  return {
    activeBuildSlot:
      dashboard?.activeBuildSlot ?? {
        projectName: projectSnapshots[0]?.name ?? "No active build",
        phase: projectSnapshots[0]?.phase ?? "PARKED",
        progress: projectSnapshots[0]?.progress ?? 0,
        lastSession: projectSnapshots[0]?.latestHandoff ?? "No session recorded.",
        nextAction: projectSnapshots[0]?.nextAction ?? "Load Postgres runtime state",
        blockers: projectSnapshots[0]?.blocker ?? "None",
      },
    projects: projectSnapshots,
    buildQueue: dashboard?.buildQueue ?? [],
    pendingDecisions: dashboard?.pendingDecisions ?? [],
    decisionItems: dashboard?.decisionItems ?? [],
    usageSummary: dashboard?.usageSummary,
    scoutSummary: dashboard?.scoutSummary ?? "No scout report yet.",
    systemHealth:
      dashboard?.systemHealth ?? {
        orchestratorLastActive: "Not run yet",
        templatesVersion: "1.0",
        productsShipped: 0,
      },
    recentFeedback: dashboard?.recentFeedback ?? [],
    activeRuns: dashboard?.activeRuns ?? [],
  }
}
