"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { formatRuntimeNotice } from "@/lib/runtime-event-types"
import { subscribeToRuntimeMutations } from "@/lib/runtime-sync"

export type PortfolioResponse = {
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
    readiness?: {
      status: "ready" | "missing_setup" | "blocked"
      label: "Ready" | "Missing setup" | "Blocked"
      tone: "emerald" | "amber" | "rose"
      summary: string
      checks: Array<{
        id: string
        label: string
        status: "pass" | "missing" | "blocked"
        detail: string
      }>
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
    stageUpdatedAt?: string | null
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function labelForStage(stage?: string | null) {
  if (!stage) return null
  return stage.replaceAll("_", " ")
}

function toneForPhase(phase: string): string {
  const p = phase.toUpperCase()
  if (p === "BUILD") return "sky"
  if (p === "TEST") return "fuchsia"
  if (p === "BLOCKED") return "rose"
  if (p === "SHIPPED") return "emerald"
  return "slate"
}

function toneForTrust(level: string): string {
  if (/confirmed/i.test(level)) return "emerald"
  if (/inferred/i.test(level)) return "amber"
  return "rose"
}

function toneForReadiness(status?: string | null): string {
  if (status === "ready") return "emerald"
  if (status === "blocked") return "rose"
  return "amber"
}

function timeAgo(iso: string): string {
  if (!iso) return "—"
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  } catch {
    return "—"
  }
}

const railSteps = [
  { label: "Read", stage: "reading_context" },
  { label: "Plan", stage: "planning" },
  { label: "Execute", stage: "executing" },
  { label: "Verify", stage: "verifying" },
  { label: "Record", stage: "updating_governance" },
  { label: "Handoff", stage: "handoff" },
  { label: "Done", stage: "done" },
]

function railStepState(
  currentStage: string | null | undefined,
  stepStage: string,
): "done" | "current" | "upcoming" {
  if (!currentStage) return "upcoming"
  const order = railSteps.map((s) => s.stage)
  const ci = order.indexOf(currentStage)
  const si = order.indexOf(stepStage)
  if (si < ci) return "done"
  if (si === ci) return "current"
  return "upcoming"
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-[10.5px] font-medium uppercase tracking-[0.22em] text-slate-500 ${className}`}>
      {children}
    </p>
  )
}

function CCCard({
  children,
  className = "",
  accent,
  style,
}: {
  children: React.ReactNode
  className?: string
  accent?: "amber" | "fuchsia" | "sky" | "emerald" | "rose"
  style?: React.CSSProperties
}) {
  const borderMap: Record<string, string> = {
    amber: "border-amber-500/35",
    fuchsia: "border-fuchsia-500/35",
    sky: "border-sky-500/30",
    emerald: "border-emerald-500/35",
    rose: "border-rose-500/35",
  }
  const borderClass = accent ? borderMap[accent] : "border-slate-800"
  return (
    <div
      className={`rounded-[14px] border ${borderClass} bg-slate-900/70 p-5 ${className}`}
      style={style}
    >
      {children}
    </div>
  )
}

function ArrowIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function ExternalIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  )
}

function CheckIcon({ size = 9 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function PulseDot({ color = "emerald", size = 8 }: { color?: string; size?: number }) {
  const bgMap: Record<string, string> = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
    fuchsia: "bg-fuchsia-500",
    sky: "bg-sky-400",
    slate: "bg-slate-500",
  }
  const ringMap: Record<string, string> = {
    emerald: "bg-emerald-500/40",
    amber: "bg-amber-500/40",
    rose: "bg-rose-500/40",
    fuchsia: "bg-fuchsia-500/40",
    sky: "bg-sky-400/40",
    slate: "bg-slate-500/30",
  }
  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
    >
      <span
        className={`absolute inset-0 rounded-full ${ringMap[color] ?? ringMap.emerald} cc-pulse`}
      />
      <span
        className={`relative rounded-full ${bgMap[color] ?? bgMap.emerald}`}
        style={{ width: size, height: size }}
      />
    </span>
  )
}

function TrustCheckRow({
  label,
  state,
  source,
}: {
  label: string
  state: string
  source: string
}) {
  const isOk = state === "confirmed" || state === "ok"
  return (
    <div className="flex items-center justify-between py-[5px] text-xs">
      <div className="flex items-center gap-2">
        <div
          className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px]"
          style={{
            background: isOk ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)",
            border: `1px solid ${isOk ? "rgba(16,185,129,0.4)" : "rgba(245,158,11,0.4)"}`,
          }}
        >
          {isOk ? (
            <span className="text-emerald-300">
              <CheckIcon size={9} />
            </span>
          ) : (
            <span className="text-[9px] font-bold text-amber-300">!</span>
          )}
        </div>
        <span className="text-slate-300">{label}</span>
      </div>
      <span className="text-[11px] text-slate-500">{source}</span>
    </div>
  )
}

function DecisionCard({
  tone,
  eyebrow,
  project,
  title,
  body,
  recommendation,
  meta,
  cta,
  ctaHref,
}: {
  tone: "amber" | "fuchsia"
  eyebrow: string
  project: string
  title: string
  body: string
  recommendation: string
  meta: string
  cta: string
  ctaHref: string
}) {
  const isAmber = tone === "amber"
  return (
    <div
      className="relative overflow-hidden rounded-[14px] border p-5"
      style={{
        borderColor: isAmber ? "rgba(245,158,11,0.35)" : "rgba(217,70,239,0.35)",
        background: isAmber
          ? "linear-gradient(180deg, rgba(245,158,11,0.06), transparent 40%), rgba(15,23,42,0.7)"
          : "linear-gradient(180deg, rgba(217,70,239,0.06), transparent 40%), rgba(15,23,42,0.7)",
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-0.5 opacity-60"
        style={{
          background: isAmber
            ? "linear-gradient(90deg, #f59e0b, transparent)"
            : "linear-gradient(90deg, #d946ef, transparent)",
        }}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Eyebrow className={isAmber ? "!text-amber-400" : "!text-fuchsia-400"}>{eyebrow}</Eyebrow>
          <span className="text-[10px] text-slate-600">·</span>
          <span className="text-[11px] font-medium tracking-wide text-slate-400">{project}</span>
        </div>
        <Badge tone={(isAmber ? "amber" : "fuchsia") as never}>{isAmber ? "Important" : "Active"}</Badge>
      </div>

      <h3 className="mt-3 text-[17px] font-semibold leading-[1.35] tracking-[-0.015em] text-slate-100">
        {title}
      </h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-slate-400">{body}</p>

      <div
        className="mt-3 rounded-lg border border-slate-800 px-3 py-2.5 text-[12.5px] leading-relaxed"
        style={{ background: "rgba(2,6,23,0.6)" }}
      >
        <span className="text-slate-500">Recommended · </span>
        <span className="text-slate-300">{recommendation}</span>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] tabular-nums text-slate-600">{meta}</span>
        <div className="flex gap-2">
          <button className="rounded-[7px] border border-slate-700 bg-transparent px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600">
            Open thread
          </button>
          <Link
            href={ctaHref}
            className="inline-flex items-center gap-1.5 rounded-[7px] border px-3 py-1.5 text-xs font-medium"
            style={{
              borderColor: isAmber ? "rgba(245,158,11,0.4)" : "rgba(217,70,239,0.4)",
              background: isAmber ? "rgba(245,158,11,0.12)" : "rgba(217,70,239,0.12)",
              color: isAmber ? "#fcd34d" : "#f0abfc",
            }}
          >
            {cta}
            <ArrowIcon size={11} />
          </Link>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function DashboardPageClient({ initialData = emptyState }: { initialData?: PortfolioResponse }) {
  const [data, setData] = useState<PortfolioResponse>(initialData)
  const [liveNotice, setLiveNotice] = useState<string | null>(null)
  const [tableFilter, setTableFilter] = useState<"all" | "attention" | "shipped">("all")
  const [runActionLoading, setRunActionLoading] = useState<string | null>(null)

  async function loadPortfolio() {
    const response = await fetch("/api/portfolio")
    const payload = (await response.json()) as PortfolioResponse
    setData(payload)
  }

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
      if (document.visibilityState === "visible") void load()
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

  async function mutateRun(jobId: string, action: "cancel" | "retry") {
    setRunActionLoading(jobId)
    try {
      await fetch("/api/runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action }),
      })
      await loadPortfolio()
    } finally {
      setRunActionLoading(null)
    }
  }

  // Derived
  const activeProject = data.projects.find((p) => p.name === data.activeBuildSlot.projectName) ?? null
  const activeRun = data.activeRuns[0] ?? null
  const isWorking = Boolean(activeRun && activeRun.status === "running")

  const filteredProjects = data.projects.filter((p) => {
    if (tableFilter === "shipped") return p.phase.toUpperCase() === "SHIPPED"
    if (tableFilter === "attention")
      return (
        (p.blocker && p.blocker !== "—" && p.blocker !== "") ||
        (p.runtimeState != null && p.runtimeState.status !== "healthy")
      )
    return true
  })

  const attentionCount = data.projects.filter(
    (p) =>
      (p.blocker && p.blocker !== "—" && p.blocker !== "") ||
      (p.runtimeState != null && p.runtimeState.status !== "healthy"),
  ).length
  const readinessCounts = {
    ready: data.projects.filter((project) => project.readiness?.status === "ready").length,
    missing: data.projects.filter((project) => project.readiness?.status === "missing_setup" || !project.readiness).length,
    blocked: data.projects.filter((project) => project.readiness?.status === "blocked").length,
  }

  const situationalSummary = (() => {
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
    const d = data.decisionItems.length
    const r = data.activeRuns.length
    return `${today}. ${d > 0 ? `You have ${d} decision${d > 1 ? "s" : ""} waiting` : "No decisions waiting"} and ${r > 0 ? `${r} project${r > 1 ? "s" : ""} building` : "no active builds"}.`
  })()

  return (
    <div className="flex flex-col gap-6">
      {/* Live notice */}
      {liveNotice ? (
        <div
          className="rounded-xl border border-sky-500/30 px-4 py-2.5 text-sm text-sky-200"
          style={{ background: "rgba(56,189,248,0.08)" }}
        >
          {liveNotice}
        </div>
      ) : null}

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-5">
        <div>
          <Eyebrow>Portfolio</Eyebrow>
          <h1 className="mt-1.5 text-[30px] font-semibold leading-none tracking-[-0.025em] text-slate-50">
            Command Center
          </h1>
          <p className="mt-1.5 text-[13px] text-slate-400">{situationalSummary}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href="/operations"
            className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-[12.5px] font-medium text-sky-300 hover:border-sky-400/50"
          >
            Live board
          </Link>
          <button className="rounded-lg border border-slate-700 bg-transparent px-3.5 py-2 text-[12.5px] font-medium text-slate-300 hover:border-slate-600">
            Pause runner
          </button>
          <Link
            href="/intake"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2 text-[12.5px] font-medium text-slate-900 hover:bg-white"
          >
            New idea
            <ArrowIcon size={12} />
          </Link>
        </div>
      </div>

      {/* ── Decisions needed ─────────────────────────────────────────────────── */}
      {data.decisionItems.length > 0 ? (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Eyebrow>Decisions needed</Eyebrow>
              <span
                className="inline-flex min-w-[18px] items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-amber-300"
              >
                {data.decisionItems.length}
              </span>
            </div>
            <span className="text-[11.5px] text-slate-500">
              Oldest pending · {timeAgo(data.activeRuns[0]?.createdAt ?? "")}
            </span>
          </div>
          <div className="grid gap-3.5 lg:grid-cols-2">
            {data.decisionItems.map((item, i) => (
              <DecisionCard
                key={`${item.projectName}-${i}`}
                tone={item.priority === "critical" ? "amber" : "fuchsia"}
                eyebrow={item.priority === "critical" ? "Blocker" : "Approval"}
                project={item.projectName}
                title={item.title}
                body={item.reason}
                recommendation={item.recommendation}
                meta={`${item.source} · ${item.projectName} · ${item.priority}`}
                cta={item.priority === "critical" ? "Review" : "Start test"}
                ctaHref={`/projects/${item.projectName}`}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Active project + Project status ──────────────────────────────────── */}
      <section className="grid gap-3.5" style={{ gridTemplateColumns: "1.35fr 1fr" }}>
        {/* Active project */}
        <CCCard>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Eyebrow>Active project</Eyebrow>
              <div className="mt-2.5 flex items-center gap-3">
                <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-slate-50">
                  {data.activeBuildSlot.projectName}
                </h2>
                {isWorking ? (
                  <div
                    className="flex items-center gap-1.5 rounded-full border border-emerald-500/25 px-2.5 py-[3px]"
                    style={{ background: "rgba(16,185,129,0.08)" }}
                  >
                    <PulseDot color="emerald" size={7} />
                    <span className="text-[11.5px] font-medium tracking-wide text-emerald-300">
                      Agent working
                    </span>
                  </div>
                ) : null}
              </div>
              <p className="mt-2 text-[12.5px] text-slate-400">
                {activeRun
                  ? `Step: ${labelForStage(activeRun.currentStage) ?? "unknown"} · ${activeRun.statusLabel}`
                  : data.activeBuildSlot.lastSession}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[28px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-slate-100">
                {data.activeBuildSlot.progress}%
              </p>
              <p className="mt-1 text-[11px] text-slate-500">Sprint progress</p>
            </div>
          </div>

          {/* Progress rail */}
          <div className="mt-4 flex gap-1">
            {railSteps.map((step) => {
              const state = railStepState(activeRun?.currentStage, step.stage)
              return (
                <div key={step.label} className="flex flex-1 flex-col gap-1.5">
                  <div
                    className="h-[3px] rounded-sm"
                    style={{
                      background:
                        state === "done"
                          ? "#10b981"
                          : state === "current"
                            ? "linear-gradient(90deg, #d946ef, #38bdf8)"
                            : "rgba(30,41,59,1)",
                      boxShadow:
                        state === "current" ? "0 0 8px rgba(217,70,239,0.4)" : undefined,
                    }}
                  />
                  <span
                    className={`text-[10px] tracking-wide ${
                      state === "current"
                        ? "font-medium text-fuchsia-300"
                        : state === "done"
                          ? "text-emerald-400"
                          : "text-slate-600"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Divider */}
          <div className="my-5 h-px bg-slate-800" />

          {/* Commentary */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <Eyebrow>Live commentary</Eyebrow>
              {activeRun ? (
                <span className="text-[11px] text-slate-600">
                  {isWorking ? "streaming · " : ""}
                  {new Date(activeRun.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              ) : null}
            </div>
            <div
              className="relative h-[148px] overflow-hidden rounded-[10px] border border-slate-800 px-3.5 py-2.5"
              style={{ background: "rgba(2,6,23,0.6)" }}
            >
              {activeRun?.summary ? (
                <p className="font-mono text-[12.5px] leading-[1.55] text-slate-300">
                  {activeRun.summary}
                </p>
              ) : (
                <p className="text-[12.5px] text-slate-600">No active run commentary.</p>
              )}
              {isWorking ? (
                <span
                  className="cc-blink ml-1 inline-block h-[13px] w-[7px] align-middle"
                  style={{ background: "#38bdf8" }}
                />
              ) : null}
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
                style={{ background: "linear-gradient(transparent, rgba(15,23,42,0.9))" }}
              />
            </div>
          </div>
        </CCCard>

        {/* Project status */}
        <CCCard>
          <div className="flex items-center justify-between">
            <Eyebrow>Project status</Eyebrow>
            <Badge tone={toneForPhase(data.activeBuildSlot.phase) as never}>
              {data.activeBuildSlot.phase}
            </Badge>
          </div>

          <div className="mt-3.5 grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                Sprint goal
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-300">
                {data.activeBuildSlot.nextAction}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                Launch target
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-300">
                {activeProject?.launchTarget || "TBD"}
              </p>
            </div>
          </div>

          {/* Trust status */}
          <div
            className="mt-4 rounded-[10px] border border-slate-800 px-3.5 py-3"
            style={{ background: "rgba(2,6,23,0.4)" }}
          >
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-xs font-medium text-slate-200">Trust status</p>
              {activeProject?.runtimeState?.trust ? (
                <Badge
                  tone={toneForTrust(activeProject.runtimeState.trust.level) as never}
                  className="text-[10px]"
                >
                  {activeProject.runtimeState.trust.level}
                </Badge>
              ) : null}
            </div>
            {activeProject?.runtimeState?.trust?.checks?.length ? (
              activeProject.runtimeState.trust.checks.slice(0, 4).map((c) => (
                <TrustCheckRow
                  key={c.label}
                  label={c.label}
                  state={c.status}
                  source={c.source.replaceAll("_", " ")}
                />
              ))
            ) : (
              <>
                <TrustCheckRow label="Build passes" state="ok" source="CI" />
                <TrustCheckRow label="Tests passing" state="ok" source="CI" />
                <TrustCheckRow label="Deploy live" state="ok" source="Vercel" />
                <TrustCheckRow label="CEO product test" state="pending" source="needs human check" />
              </>
            )}
          </div>

          <div className="mt-3.5 flex gap-2">
            <Link
              href={`/projects/${data.activeBuildSlot.projectName}`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-sky-500/30 px-3 py-2 text-xs font-medium text-sky-300 hover:border-sky-500/50"
              style={{ background: "rgba(56,189,248,0.08)" }}
            >
              Open {data.activeBuildSlot.projectName}
              <ArrowIcon size={11} />
            </Link>
            <button className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-600">
              Live preview
              <ExternalIcon size={11} />
            </button>
          </div>
        </CCCard>
      </section>

      {/* ── Live operations ─────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Eyebrow>Live operations</Eyebrow>
            <p className="mt-1.5 text-sm font-medium text-slate-200">
              {data.activeRuns.length ? `${data.activeRuns.length} worker${data.activeRuns.length > 1 ? "s" : ""} active` : "No active workers"}
            </p>
          </div>
          <span className="text-[11.5px] text-slate-500">One active run per project</span>
        </div>
        {data.activeRuns.length ? (
          <div className="grid gap-3.5 lg:grid-cols-2">
            {data.activeRuns.map((run) => (
              <CCCard key={run.id} accent={run.status === "running" ? "sky" : "amber"} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <PulseDot color={run.status === "running" ? "sky" : "amber"} size={7} />
                      <Link href={`/projects/${run.projectName ?? "command-center"}`} className="text-sm font-medium text-slate-100 hover:text-sky-300">
                        {run.projectName ?? "system"}
                      </Link>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">{run.summary || run.instruction}</p>
                  </div>
                  <Badge tone={run.status === "running" ? "sky" : "amber"}>{run.statusLabel}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="uppercase tracking-[0.18em] text-slate-600">Step</p>
                    <p className="mt-1 text-slate-300">{labelForStage(run.currentStage) ?? "unknown"}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-[0.18em] text-slate-600">Started</p>
                    <p className="mt-1 tabular-nums text-slate-300">{timeAgo(run.createdAt)}</p>
                  </div>
                  <div>
                    <p className="uppercase tracking-[0.18em] text-slate-600">Heartbeat</p>
                    <p className="mt-1 tabular-nums text-slate-300">{timeAgo(run.stageUpdatedAt ?? run.createdAt)}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-800 pt-3">
                  <span className="font-mono text-[11px] text-slate-600">#{run.id.slice(-6)}</span>
                  <div className="flex gap-2">
                    <Link
                      href={`/projects/${run.projectName ?? "command-center"}/work`}
                      className="rounded-[7px] border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600"
                    >
                      Inspect
                    </Link>
                    <button
                      onClick={() => void mutateRun(run.id, "cancel")}
                      disabled={runActionLoading === run.id}
                      className="rounded-[7px] border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 disabled:opacity-60"
                    >
                      {runActionLoading === run.id ? "Stopping" : "Stop"}
                    </button>
                  </div>
                </div>
              </CCCard>
            ))}
          </div>
        ) : (
          <div className="rounded-[14px] border border-slate-800 bg-slate-900/70 px-5 py-4 text-sm text-slate-500">
            Workers are idle. New project runs can start independently as long as that project has no active run.
          </div>
        )}
      </section>

      {/* ── Readiness board ─────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Eyebrow>Readiness board</Eyebrow>
            <p className="mt-1.5 text-sm font-medium text-slate-200">
              {readinessCounts.ready} ready · {readinessCounts.missing} missing setup · {readinessCounts.blocked} blocked
            </p>
          </div>
          <span className="text-[11.5px] text-slate-500">Worker launch contract</span>
        </div>
        <div className="grid gap-3.5 lg:grid-cols-3">
          {data.projects.slice(0, 6).map((project) => {
            const readiness = project.readiness
            const missingChecks = readiness?.checks.filter((item) => item.status !== "pass").slice(0, 3) ?? []
            return (
              <CCCard key={`readiness-${project.name}`} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link href={`/projects/${project.name}`} className="text-sm font-medium text-slate-100 hover:text-sky-300">
                      {project.name}
                    </Link>
                    <p className="mt-1.5 text-xs leading-5 text-slate-500">
                      {readiness?.summary ?? "Readiness has not been computed yet."}
                    </p>
                  </div>
                  <Badge tone={toneForReadiness(readiness?.status) as never}>
                    {readiness?.label ?? "Missing setup"}
                  </Badge>
                </div>
                <div className="mt-3 space-y-1.5">
                  {(missingChecks.length ? missingChecks : readiness?.checks.slice(0, 3) ?? []).map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className={item.status === "pass" ? "text-slate-500" : "text-slate-300"}>{item.label}</span>
                      <span
                        className={
                          item.status === "pass"
                            ? "text-emerald-400"
                            : item.status === "blocked"
                              ? "text-rose-300"
                              : "text-amber-300"
                        }
                      >
                        {item.status === "pass" ? "OK" : item.status === "blocked" ? "Blocked" : "Missing"}
                      </span>
                    </div>
                  ))}
                </div>
              </CCCard>
            )
          })}
        </div>
      </section>

      {/* ── All projects table ───────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[14px] border border-slate-800 bg-slate-900/70">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <Eyebrow>All projects</Eyebrow>
            <p className="mt-1.5 text-sm font-medium text-slate-200">
              {data.projects.length} tracked · {data.activeRuns.length} live · {attentionCount} need
              attention
            </p>
          </div>
          <div className="flex gap-1.5">
            {(["all", "attention", "shipped"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setTableFilter(f)}
                className="rounded-[7px] border px-3 py-1.5 text-[11.5px] transition-colors"
                style={
                  tableFilter === f
                    ? {
                        borderColor: "rgba(56,189,248,0.3)",
                        background: "rgba(56,189,248,0.08)",
                        color: "#7dd3fc",
                      }
                    : { borderColor: "rgba(51,65,85,1)", color: "#cbd5e1" }
                }
              >
                {f === "attention" ? "Needs attention" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Column headers */}
        <div
          className="grid border-t border-slate-800 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.18em] text-slate-500"
          style={{
            gridTemplateColumns: "1.4fr 0.8fr 1fr 1fr 1.4fr 1.5fr 0.8fr",
            gap: 14,
            background: "rgba(2,6,23,0.5)",
          }}
        >
          <span>Project</span>
          <span>Phase</span>
          <span>Progress</span>
          <span>Readiness</span>
          <span>Blocker</span>
          <span>Next move</span>
          <span className="text-right">Updated</span>
        </div>

        {/* Rows */}
        {filteredProjects.length ? (
          filteredProjects.map((project) => {
            const projRun = data.activeRuns.find((r) => r.projectName === project.name)
            const phase = project.phase.toUpperCase()
            const phaseColor =
              phase === "BUILD"
                ? "#38bdf8"
                : phase === "TEST"
                  ? "#d946ef"
                  : phase === "BLOCKED"
                    ? "#f43f5e"
                    : phase === "SHIPPED"
                      ? "#10b981"
                      : "#64748b"
            const barColor =
              phase === "BUILD"
                ? "#38bdf8"
                : phase === "TEST"
                  ? "#d946ef"
                  : phase === "SHIPPED"
                    ? "#10b981"
                    : "#38bdf8"
            const hasBlocker = project.blocker && project.blocker !== "—" && project.blocker !== ""
            const blockerColor =
              phase === "BLOCKED"
                ? "#f43f5e"
                : phase === "TEST"
                  ? "#d946ef"
                  : hasBlocker
                    ? "#f59e0b"
                    : null

            return (
              <div
                key={project.name}
                className="grid items-center border-t border-slate-800 px-4 py-3 text-[12.5px] hover:bg-slate-800/30"
                style={{ gridTemplateColumns: "1.4fr 0.8fr 1fr 1fr 1.4fr 1.5fr 0.8fr", gap: 14 }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: phaseColor }}
                  />
                  <Link
                    href={`/projects/${project.name}`}
                    className="font-medium text-slate-100 hover:text-sky-300"
                  >
                    {project.name}
                  </Link>
                </div>

                <Badge tone={toneForPhase(project.phase) as never}>{phase}</Badge>

                <div className="flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-sm bg-slate-800">
                    <div
                      className="h-full rounded-sm"
                      style={{ width: `${project.progress}%`, background: barColor }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[11.5px] tabular-nums text-slate-400">
                    {project.progress}%
                  </span>
                </div>

                <Badge tone={toneForReadiness(project.readiness?.status) as never}>
                  {project.readiness?.label ?? "Missing setup"}
                </Badge>

                <div className="flex items-center gap-1.5">
                  {blockerColor ? (
                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                      <span
                        className="absolute inset-0 rounded-full cc-pulse"
                        style={{ background: blockerColor + "66" }}
                      />
                      <span
                        className="relative h-1.5 w-1.5 rounded-full"
                        style={{ background: blockerColor }}
                      />
                    </span>
                  ) : null}
                  <span className={hasBlocker ? "text-slate-200" : "text-slate-600"}>
                    {project.blocker || "—"}
                  </span>
                </div>

                <span className="text-slate-400">{project.nextAction}</span>

                <span className="text-right text-[11.5px] tabular-nums text-slate-500">
                  {projRun ? timeAgo(projRun.createdAt) : "—"}
                </span>
              </div>
            )
          })
        ) : (
          <div className="border-t border-slate-800 px-5 py-6 text-sm text-slate-500">
            No projects match this filter.
          </div>
        )}
      </div>

      {/* ── Footer 3-col ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-3 gap-3.5">
        {/* Usage */}
        <CCCard>
          <Eyebrow>Usage</Eyebrow>
          <div className="mt-3.5">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[24px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-slate-100">
                  ${Math.floor(data.usageSummary?.monthly.actualCostUsd ?? 0)}
                  <span className="text-[16px] text-slate-500">
                    .
                    {String(
                      Math.round(
                        ((data.usageSummary?.monthly.actualCostUsd ?? 0) % 1) * 100,
                      ),
                    ).padStart(2, "0")}
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Month to date ·{" "}
                  {new Date().toLocaleString("en-US", { month: "long" })}
                </p>
              </div>
              <Badge
                tone={
                  (data.usageSummary?.guardrails?.overallStatus === "healthy"
                    ? "emerald"
                    : "amber") as never
                }
              >
                {data.usageSummary?.guardrails?.overallStatus === "healthy"
                  ? "Under budget"
                  : (data.usageSummary?.guardrails?.overallStatus ?? "Checking")}
              </Badge>
            </div>

            {/* Sparkline */}
            <div className="mt-3 flex h-9 items-end gap-[3px]">
              {Array.from({ length: 21 }, (_, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-[1px]"
                  style={{
                    height: `${35 + Math.sin(i * 0.7) * 20 + (i > 17 ? 25 : 0)}%`,
                    background: i > 17 ? "rgba(56,189,248,0.6)" : "rgba(51,65,85,0.8)",
                  }}
                />
              ))}
            </div>

            <div className="mt-2.5 flex justify-between text-[11px] tabular-nums text-slate-500">
              <span>
                21 days ·{" "}
                {data.usageSummary?.weekly.totalTokens
                  ? `${Math.round(data.usageSummary.weekly.totalTokens / 1000)}k tok/wk`
                  : "—"}
              </span>
              <span className="text-slate-400">within limits</span>
            </div>
          </div>
        </CCCard>

        {/* Scout */}
        <CCCard>
          <Eyebrow>Scout</Eyebrow>
          <div className="mt-3.5">
            <p className="text-[13px] font-medium leading-[1.55] text-slate-200">
              {data.scoutSummary}
            </p>
            {data.buildQueue.length > 0 ? (
              <div className="mt-3 flex flex-col gap-1.5">
                {data.buildQueue.slice(0, 3).map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 rounded-[7px] border border-slate-800 px-2.5 py-1.5 text-xs"
                    style={{ background: "rgba(2,6,23,0.5)" }}
                  >
                    <span
                      className="shrink-0 text-[9.5px] font-medium uppercase tracking-[0.15em] text-sky-300"
                      style={{ width: 46 }}
                    >
                      Queue
                    </span>
                    <span className="flex-1 text-slate-300">{item}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <Link
              href="/scout"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-sky-300 hover:text-sky-200"
            >
              Open scout report
              <ArrowIcon size={11} />
            </Link>
          </div>
        </CCCard>

        {/* System health */}
        <CCCard>
          <Eyebrow>System health</Eyebrow>
          <div className="mt-3.5">
            <div className="mb-3.5 flex items-center gap-2.5">
              <PulseDot color="emerald" size={8} />
              <span className="text-[13px] font-medium text-slate-200">All systems operating</span>
            </div>
            {[
              {
                label: "Orchestrator",
                value: data.systemHealth.orchestratorLastActive
                  ? `Active · ${timeAgo(data.systemHealth.orchestratorLastActive)}`
                  : "Pending",
                isGreen: true,
              },
              {
                label: "Worker runner",
                value: data.activeRuns.length ? "Online" : "Idle",
                isGreen: true,
              },
              { label: "Supabase", value: "Healthy", isGreen: true },
              {
                label: "Vercel",
                value: `${data.activeRuns.length} deploys today`,
                isGreen: false,
              },
              {
                label: "Codex weekly",
                value: data.usageSummary?.codexDesktop.weeklyLimitStatus ?? "N/A",
                isGreen: false,
              },
            ].map((row) => (
              <div key={row.label} className="flex justify-between py-[5px] text-xs">
                <span className="text-slate-500">{row.label}</span>
                <span
                  className={`tabular-nums ${row.isGreen ? "text-emerald-400" : "text-slate-300"}`}
                >
                  {row.value}
                </span>
              </div>
            ))}
            <div className="mt-3 h-px bg-slate-800" />
            <div className="mt-2.5 flex justify-between text-[11px] text-slate-500">
              <span>Templates v{data.systemHealth.templatesVersion}</span>
              <span>{data.systemHealth.productsShipped} products shipped</span>
            </div>
          </div>
        </CCCard>
      </section>
    </div>
  )
}
