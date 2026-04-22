import { promises as fs } from "fs"
import { mapSupabaseRunToRuntimeJob, type SupabaseRunRow } from "@/lib/inngest-run-store"
import { readPortfolioProjectsWithCommandCenter, getPortfolioPath } from "@/lib/managed-projects"
import { mapJobToOperationsRun, splitOperationsRuns, type OperationsRun } from "@/lib/operations-run-card"
import { getDeveloperPath } from "@/lib/orchestration"
import { getSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env"

export type OperationsLiveData = {
  generatedAt: string
  projects: Array<{
    name: string
    phase: string
    progress: number
    blocker: string
    nextAction: string
    launchTarget: string
  }>
  activeRuns: OperationsRun[]
  recentRuns: OperationsRun[]
}

async function listRunRowsByStatus(status: string, limit = 20, timeoutMs = 900) {
  if (!isSupabaseConfigured()) return []
  const { url, serviceRoleKey } = getSupabaseEnv()
  const params = new URLSearchParams()
  params.set("select", "id,project_id,thread_id,run_template,instruction,status,current_stage,summary,created_at,started_at,completed_at,metadata")
  params.set("status", `eq.${status}`)
  params.set("order", "created_at.desc")
  params.set("limit", String(limit))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/runs?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
    })
    if (!response.ok) return []
    return (await response.json()) as SupabaseRunRow[]
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

async function getFastOperationsJobs() {
  const rows = await Promise.all([
    listRunRowsByStatus("running"),
    listRunRowsByStatus("queued"),
    listRunRowsByStatus("completed", 8),
    listRunRowsByStatus("awaiting_ceo", 8),
    listRunRowsByStatus("failed", 8),
    listRunRowsByStatus("timed_out", 8),
    listRunRowsByStatus("blocked", 8),
    listRunRowsByStatus("cancelled", 8),
  ])
  return rows
    .flat()
    .filter((run) => run.metadata?.engine === "inngest")
    .map((run) => mapSupabaseRunToRuntimeJob(run, []))
    .sort((left, right) => {
      const leftTime = left.stageUpdatedAt ?? left.completedAt ?? left.createdAt
      const rightTime = right.stageUpdatedAt ?? right.completedAt ?? right.createdAt
      return rightTime.localeCompare(leftTime)
    })
}

export async function getOperationsLiveData(developerPath = getDeveloperPath()): Promise<OperationsLiveData> {
  const portfolioMarkdown = await fs.readFile(getPortfolioPath(developerPath), "utf8").catch(() => "")
  const [projects, jobs] = await Promise.all([
    readPortfolioProjectsWithCommandCenter(developerPath, portfolioMarkdown).catch(() => []),
    getFastOperationsJobs(),
  ])
  const { activeRuns, recentRuns } = splitOperationsRuns(jobs.map(mapJobToOperationsRun))

  return {
    generatedAt: new Date().toISOString(),
    projects: projects.map((project) => ({
      name: project.name,
      phase: project.phase,
      progress: project.progress,
      blocker: project.blocker,
      nextAction: project.nextAction,
      launchTarget: project.launchTarget,
    })),
    activeRuns,
    recentRuns,
  }
}
