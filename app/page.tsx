"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { PortfolioTable } from "@/components/portfolio-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { formatRuntimeNotice } from "@/lib/runtime-event-types"
import { subscribeToRuntimeMutations } from "@/lib/runtime-sync"

type PortfolioResponse = {
  activeBuildSlot: {
    projectName: string
    phase: string
    progress: number
    lastSession: string
    nextAction: string
    blockers: string
  }
  projects: Array<{
    name: string
    phase: string
    progress: number
    blocker: string
    nextAction: string
    launchTarget: string
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
  }>
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
  usageSummary?: {
    monthly: {
      totalTokens: number
      estimatedCostUsd: number
      actualCostUsd: number
      estimatedCodexCostUsd: number
    }
    weekly: {
      totalTokens: number
      estimatedCostUsd: number
    }
    codexDesktop: {
      weeklyLimitStatus: string
      currentUsageStatus: string
    }
    guardrails?: {
      overallStatus: string
      headline: string
      recommendedAction: string
    }
    byProject: Record<string, { tokens: number; cost: number }>
  }
  scoutSummary: string
  systemHealth: {
    orchestratorLastActive: string
    templatesVersion: string
    productsShipped: number
  }
  activeRuns: Array<{
    id: string
    projectName: string | null
    status: string
    statusLabel: string
    instruction: string
    createdAt: string
    summary: string
    currentStage: string
  }>
  recentFeedback?: Array<{
    id: string
    scopeLabel: string
    statusLabel: string
    summary: string
    resolutionNote: string | null
  }>
}

const emptyState: PortfolioResponse = {
  activeBuildSlot: {
    projectName: "No active build",
    phase: "PARKED",
    progress: 0,
    lastSession: "No session recorded",
    nextAction: "Load PORTFOLIO.md",
    blockers: "None",
  },
  projects: [],
  buildQueue: [],
  pendingDecisions: [],
  decisionItems: [],
  scoutSummary: "No scout report yet.",
  systemHealth: {
    orchestratorLastActive: "Not run yet",
    templatesVersion: "1.0",
    productsShipped: 0,
  },
  activeRuns: [],
  recentFeedback: [],
  usageSummary: {
    monthly: { totalTokens: 0, estimatedCostUsd: 0, actualCostUsd: 0, estimatedCodexCostUsd: 0 },
    weekly: { totalTokens: 0, estimatedCostUsd: 0 },
    codexDesktop: {
      weeklyLimitStatus: "Unavailable from local Codex runtime",
      currentUsageStatus: "Direct Codex quota/limit telemetry is not exposed here yet",
    },
    guardrails: {
      overallStatus: "healthy",
      headline: "Usage is within a comfortable range for normal project work.",
      recommendedAction: "Normal project chat and investigation behavior is safe.",
    },
    byProject: {},
  },
}

function labelForStage(stage?: string | null) {
  if (!stage) return null
  return stage.replaceAll("_", " ")
}

function toneForStatus(value: string) {
  if (/critical/i.test(value)) return "red"
  if (/watch/i.test(value)) return "amber"
  if (/blocked/i.test(value)) return "amber"
  if (/need/i.test(value)) return "purple"
  return "green"
}

function toneForPriority(value: string) {
  if (/critical/i.test(value)) return "red"
  if (/important/i.test(value)) return "amber"
  return "neutral"
}

function toneForRuntime(value: string) {
  if (/healthy/i.test(value)) return "green"
  if (/awaiting_ceo/i.test(value)) return "purple"
  if (/blocked/i.test(value)) return "red"
  if (/stale|timed_out/i.test(value)) return "amber"
  if (/cancelled/i.test(value)) return "neutral"
  return "amber"
}

function toneForTrust(value: string) {
  if (/confirmed/i.test(value)) return "green"
  if (/inferred/i.test(value)) return "amber"
  return "red"
}

function nextTrustGap(
  trust?: {
    level: string
    headline: string
    checks?: Array<{ label: string; status: string; source: string; detail: string }>
  } | null,
) {
  if (!trust?.checks?.length) return null
  return trust.checks.find((check) => check.status !== "confirmed") ?? null
}

function toneForInvestigation(value?: string | null) {
  if (!value) return "amber"
  if (/healthy/i.test(value)) return "green"
  if (/blocked/i.test(value)) return "red"
  return "purple"
}

function toneForContextHealth(value?: string | null) {
  if (!value) return "neutral"
  if (/healthy/i.test(value)) return "green"
  if (/overloaded/i.test(value)) return "red"
  return "amber"
}

export default function DashboardPage() {
  const [data, setData] = useState<PortfolioResponse>(emptyState)
  const [liveNotice, setLiveNotice] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      const response = await fetch("/api/portfolio")
      const payload = (await response.json()) as PortfolioResponse
      if (mounted) setData(payload)
    }

    void load()
    const intervalMs = data.activeRuns.length ? 12000 : 30000
    const id = window.setInterval(() => void load(), intervalMs)
    const handleFocus = () => void load()
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void load()
      }
    }
    const unsubscribe = subscribeToRuntimeMutations((event) => {
      setLiveNotice(formatRuntimeNotice(event))
      void load()
    })
    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      mounted = false
      unsubscribe()
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibility)
      window.clearInterval(id)
    }
  }, [data.activeRuns.length])

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-sky-300">Portfolio</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">CEO dashboard</h1>
        </div>
        <Link href="/intake">
          <Button>New idea</Button>
        </Link>
      </div>

      {liveNotice ? (
        <Card className="border-sky-500/40 bg-sky-500/10">
          <p className="text-sm text-sky-100">{liveNotice}</p>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Active build slot</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">{data.activeBuildSlot.projectName}</h2>
            </div>
            <Badge tone={toneForStatus(data.activeBuildSlot.phase) as never}>{data.activeBuildSlot.phase}</Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-slate-400">Progress</p>
              <p className="mt-1 text-2xl font-semibold text-slate-100">{data.activeBuildSlot.progress}%</p>
            </div>
            <div>
              <p className="text-sm text-slate-400">Last session</p>
              <p className="mt-1 text-sm text-slate-200">{data.activeBuildSlot.lastSession}</p>
            </div>
            <div>
              <p className="text-sm text-slate-400">Next action</p>
              <p className="mt-1 text-sm text-slate-200">{data.activeBuildSlot.nextAction}</p>
            </div>
            <div>
              <p className="text-sm text-slate-400">Blockers</p>
              <p className="mt-1 text-sm text-slate-200">{data.activeBuildSlot.blockers}</p>
            </div>
          </div>
          {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState ? (
            <div className="rounded-lg border border-slate-800 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-100">Run health</p>
                <Badge
                  tone={
                    toneForRuntime(
                      data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState?.status ?? "",
                    ) as never
                  }
                >
                  {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState?.statusLabel}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-slate-300">
                {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState?.summary}
              </p>
              {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState?.currentStage ? (
                <p className="mt-2 text-xs text-sky-300">
                  Current step: {labelForStage(data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState?.currentStage)}
                </p>
              ) : null}
              {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState?.trust ? (
                <div className="mt-3 rounded-lg border border-slate-800 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Trust status</p>
                    <Badge
                      tone={
                        toneForTrust(
                          data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState?.trust?.level ?? "",
                        ) as never
                      }
                    >
                      {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState?.trust?.level}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">
                    {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState?.trust?.headline}
                  </p>
                  {nextTrustGap(data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState?.trust) ? (
                    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Next proof step</p>
                      <p className="mt-2 text-sm text-slate-200">
                        {nextTrustGap(data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState?.trust)?.label}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {nextTrustGap(data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.runtimeState?.trust)?.detail}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.investigation ? (
                <div className="mt-3 rounded-lg border border-slate-800 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Investigation</p>
                    <Badge
                      tone={
                        toneForInvestigation(
                          data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.investigation?.status,
                        ) as never
                      }
                    >
                      {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.investigation?.autonomyMode ===
                      "needs_ceo_approval"
                        ? "Needs CEO review"
                        : data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.investigation?.autonomyMode ===
                            "needs_review"
                          ? "Needs review"
                          : "Can attempt fix"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-200">
                    {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.investigation?.title}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.investigation?.likelyCause}
                  </p>
                  {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.investigation?.autonomyRationale ? (
                    <p className="mt-2 text-xs text-slate-500">
                      {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.investigation?.autonomyRationale}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-sky-300">
                    Exact next fix: {data.projects.find((project) => project.name === data.activeBuildSlot.projectName)?.investigation?.nextStep}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card className="space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">CEO attention</p>
          <div className="space-y-3">
            {data.decisionItems.length ? (
              data.decisionItems.map((item, index) => (
                <div key={`${item.projectName}-${index}`} className="rounded-lg border border-slate-800 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-100">{item.projectName}</p>
                    <Badge tone={toneForPriority(item.priority) as never}>{item.priority}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-200">{item.title}</p>
                  <p className="mt-2 text-sm text-slate-400">{item.reason}</p>
                  <p className="mt-2 text-xs text-sky-300">Recommended next move: {item.recommendation}</p>
                  <Link href={`/projects/${item.projectName}`} className="mt-3 inline-flex text-sm text-sky-300">
                    Open {item.projectName}
                  </Link>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No items currently need your attention.</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">All projects</p>
          <Badge tone="neutral">{data.projects.length} tracked</Badge>
        </div>
        <PortfolioTable projects={data.projects} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Build queue</p>
          <div className="mt-4 space-y-3">
            {data.buildQueue.length ? (
              data.buildQueue.map((item, index) => (
                <div key={`${item}-${index}`} className="rounded-lg border border-slate-800 p-3 text-sm text-slate-200">
                  {item}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No queued builds.</p>
            )}
          </div>
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Live activity</p>
          <div className="mt-4 space-y-3">
            {data.activeRuns.length ? (
              data.activeRuns.map((run) => (
                <div key={run.id} className="rounded-lg border border-slate-800 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-100">{run.projectName ?? "system"}</p>
                    <Badge tone={toneForStatus(run.status) as never}>{run.statusLabel}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{run.summary}</p>
                  <p className="mt-1 text-xs text-sky-300">Current step: {labelForStage(run.currentStage) ?? "unknown"}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(run.createdAt).toLocaleString()}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No active runs.</p>
            )}
          </div>
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Usage and limits</p>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            <div className="flex items-center justify-between gap-3">
              <p>Guardrail status</p>
              <Badge tone={toneForStatus(data.usageSummary?.guardrails?.overallStatus ?? "healthy") as never}>
                {data.usageSummary?.guardrails?.overallStatus ?? "healthy"}
              </Badge>
            </div>
            <p>Weekly usage: {data.usageSummary?.weekly.totalTokens.toLocaleString()} tokens</p>
            <p>Weekly estimated cost: ${data.usageSummary?.weekly.estimatedCostUsd.toFixed(2)}</p>
            <p>Monthly estimated cost: ${data.usageSummary?.monthly.estimatedCostUsd.toFixed(2)}</p>
            <p>Codex weekly limit: {data.usageSummary?.codexDesktop.weeklyLimitStatus}</p>
            <p className="text-xs text-slate-400">{data.usageSummary?.guardrails?.headline}</p>
            <p className="text-xs text-slate-500">{data.usageSummary?.guardrails?.recommendedAction}</p>
            <p className="text-xs text-slate-500">{data.usageSummary?.codexDesktop.currentUsageStatus}</p>
          </div>
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Projects needing attention</p>
          <div className="mt-4 space-y-3">
            {data.projects.filter((project) => project.runtimeState && (project.runtimeState.status !== "healthy" || project.runtimeState.trust?.level !== "confirmed")).length ? (
              data.projects
                .filter((project) => project.runtimeState && (project.runtimeState.status !== "healthy" || project.runtimeState.trust?.level !== "confirmed"))
                .map((project) => (
                  <div key={project.name} className="rounded-lg border border-slate-800 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-100">{project.name}</p>
                      <div className="flex gap-2">
                        <Badge tone={toneForRuntime(project.runtimeState?.status ?? "") as never}>
                          {project.runtimeState?.statusLabel}
                        </Badge>
                        {project.runtimeState?.trust ? (
                          <Badge tone={toneForTrust(project.runtimeState.trust.level) as never}>{project.runtimeState.trust.level}</Badge>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{project.runtimeState?.summary}</p>
                    {project.runtimeState?.trust ? (
                      <p className="mt-2 text-xs text-slate-400">{project.runtimeState.trust.headline}</p>
                    ) : null}
                    {nextTrustGap(project.runtimeState?.trust) ? (
                      <p className="mt-2 text-xs text-sky-300">
                        Next proof step: {nextTrustGap(project.runtimeState?.trust)?.detail}
                      </p>
                    ) : null}
                    {project.investigation ? (
                      <>
                        <p className="mt-2 text-xs text-slate-400">Likely cause: {project.investigation.likelyCause}</p>
                        <p className="mt-2 text-xs text-sky-300">Exact next fix: {project.investigation.nextStep}</p>
                        <Link href={`/projects/${project.name}/work`} className="mt-3 inline-flex text-sm text-sky-300">
                          Open investigation
                        </Link>
                      </>
                    ) : null}
                    {project.contextHealth ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge tone={toneForContextHealth(project.contextHealth.health) as never}>{project.contextHealth.health}</Badge>
                        <p className="text-xs text-slate-500">
                          Context pack: {project.contextHealth.approximateTokens} tokens · {project.contextHealth.freshness}
                        </p>
                        {project.contextHealth.compressionRatio ? (
                          <p className="text-xs text-slate-500">Compaction ratio: {project.contextHealth.compressionRatio}x</p>
                        ) : null}
                        {project.contextHealth.compactionRecommendedAction ? (
                          <p className="w-full text-xs text-slate-500">{project.contextHealth.compactionRecommendedAction}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))
            ) : (
              <p className="text-sm text-slate-400">No special attention items from recent runs.</p>
            )}
          </div>
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Recent feedback</p>
          <div className="mt-4 space-y-3">
            {data.recentFeedback?.length ? (
              data.recentFeedback.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-800 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-100">{item.scopeLabel}</p>
                    <Badge tone={toneForStatus(item.statusLabel) as never}>{item.statusLabel}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{item.summary}</p>
                  {item.resolutionNote ? <p className="mt-2 text-xs text-sky-300">{item.resolutionNote}</p> : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No recent feedback items yet.</p>
            )}
          </div>
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Scout report</p>
          <p className="mt-4 text-sm leading-7 text-slate-300">{data.scoutSummary}</p>
          <Link href="/scout" className="mt-4 inline-flex text-sm text-sky-300">
            Open scout review
          </Link>
        </Card>

        <Card>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">System health</p>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            <p>Orchestrator last active: {data.systemHealth.orchestratorLastActive}</p>
            <p>Templates version: {data.systemHealth.templatesVersion}</p>
            <p>Products shipped: {data.systemHealth.productsShipped}</p>
          </div>
        </Card>
      </div>
    </div>
  )
}
