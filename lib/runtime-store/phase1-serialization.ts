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

export function projectRowToProjectStatus(row: Phase1ProjectRow) {
  return row.metadata.phase1?.projectStatus ?? null
}

export function projectRowToPageData(row: Phase1ProjectRow) {
  return {
    projectStatus: row.metadata.phase1?.projectStatus ?? null,
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
