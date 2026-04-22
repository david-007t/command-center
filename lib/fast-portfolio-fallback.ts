import { getOperationsLiveData } from "@/lib/operations-live-data"

export async function getFastPortfolioFallback() {
  const operations = await getOperationsLiveData().catch(() => ({
    generatedAt: new Date().toISOString(),
    projects: [],
    activeRuns: [],
    recentRuns: [],
  }))
  const activeBuildSlot = operations.projects.reduce(
    (best, project) => (project.progress > best.progress ? project : best),
    operations.projects[0] ?? {
      name: "No active build",
      phase: "PARKED",
      progress: 0,
      blocker: "None",
      nextAction: "Open a project to refresh details.",
      launchTarget: "TBD",
    },
  )

  return {
    activeBuildSlot: {
      projectName: activeBuildSlot.name,
      phase: activeBuildSlot.phase,
      progress: activeBuildSlot.progress,
      lastSession: "Fast live snapshot. Open a project for full detail.",
      nextAction: activeBuildSlot.nextAction,
      blockers: activeBuildSlot.blocker,
    },
    projects: operations.projects.map((project) => ({
      ...project,
      latestHandoff: "Fast live snapshot. Open the project overview for full freshness details.",
      runtimeState: null,
      readiness: null,
      investigation: null,
      contextHealth: null,
    })),
    buildQueue: [],
    pendingDecisions: [],
    decisionItems: [],
    usageSummary: undefined,
    scoutSummary: "Fast live snapshot.",
    systemHealth: {
      orchestratorLastActive: operations.generatedAt,
      templatesVersion: "1.0",
      productsShipped: 0,
    },
    recentFeedback: [],
    activeRuns: operations.activeRuns,
  }
}
