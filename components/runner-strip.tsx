"use client"

import { useEffect, useState } from "react"
import { subscribeToRuntimeMutations } from "@/lib/runtime-sync"

type StripData = {
  runnerOnline: boolean
  runnerState: "online" | "starting" | "offline"
  activeRunCount: number
  pendingDecisionCount: number
  lastRunLabel: string
  weeklyTokens: string
  monthSpend: string
  version: string
}

function useDateStamp() {
  const [stamp, setStamp] = useState("")
  useEffect(() => {
    function fmt() {
      const now = new Date()
      const yy = String(now.getFullYear()).slice(2)
      const mm = String(now.getMonth() + 1).padStart(2, "0")
      const dd = String(now.getDate()).padStart(2, "0")
      const hh = String(now.getHours()).padStart(2, "0")
      const min = String(now.getMinutes()).padStart(2, "0")
      return `${yy}.${mm}.${dd} · ${hh}:${min}`
    }
    setStamp(fmt())
    const id = setInterval(() => setStamp(fmt()), 30000)
    return () => clearInterval(id)
  }, [])
  return stamp
}

function timeAgo(iso: string): string {
  if (!iso || iso === "Not run yet" || iso === "pending first run") return iso
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  } catch {
    return iso
  }
}

export function RunnerStrip() {
  const dateStamp = useDateStamp()
  const [strip, setStrip] = useState<StripData>({
    runnerOnline: false,
    runnerState: "offline",
    activeRunCount: 0,
    pendingDecisionCount: 0,
    lastRunLabel: "—",
    weeklyTokens: "—",
    monthSpend: "—",
    version: "1.0",
  })

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        const [portfolioRes, healthRes] = await Promise.all([
          fetch("/api/portfolio"),
          fetch("/api/runner-health", { cache: "no-store" }),
        ])
        if (!portfolioRes.ok) return
        const portfolio = await portfolioRes.json() as {
          activeRuns?: Array<unknown>
          decisionItems?: Array<unknown>
          pendingDecisions?: string[]
          systemHealth?: { orchestratorLastActive?: string; templatesVersion?: string }
          usageSummary?: {
            weekly?: { totalTokens?: number }
            monthly?: { actualCostUsd?: number; estimatedCostUsd?: number }
          }
        }
        let runnerOnline = false
        let runnerState: StripData["runnerState"] = "offline"
        if (healthRes.ok) {
          const health = await healthRes.json() as { runnerAvailable?: boolean; runnerState?: StripData["runnerState"] }
          runnerOnline = Boolean(health.runnerAvailable)
          runnerState = health.runnerState ?? (runnerOnline ? "online" : "offline")
        }
        if (!runnerOnline) {
          const startRes = await fetch("/api/runner-health", { method: "POST", cache: "no-store" }).catch(() => null)
          if (startRes?.ok) {
            const started = await startRes.json() as { runnerAvailable?: boolean; runnerState?: StripData["runnerState"] }
            runnerOnline = Boolean(started.runnerAvailable)
            runnerState = started.runnerState ?? (runnerOnline ? "online" : "starting")
          }
        }
        if (!mounted) return
        const weekly = portfolio.usageSummary?.weekly?.totalTokens ?? 0
        const monthlyCost = portfolio.usageSummary?.monthly?.actualCostUsd ?? portfolio.usageSummary?.monthly?.estimatedCostUsd ?? 0
        const weeklyLabel = weekly > 1000 ? `${Math.round(weekly / 1000)}k tokens` : `${weekly} tokens`
        setStrip({
          runnerOnline,
          runnerState,
          activeRunCount: portfolio.activeRuns?.length ?? 0,
          pendingDecisionCount: portfolio.decisionItems?.length ?? portfolio.pendingDecisions?.length ?? 0,
          lastRunLabel: timeAgo(portfolio.systemHealth?.orchestratorLastActive ?? ""),
          weeklyTokens: weeklyLabel,
          monthSpend: `$${monthlyCost.toFixed(2)}`,
          version: portfolio.systemHealth?.templatesVersion ?? "1.0",
        })
      } catch {
        // silent — strip stays stale
      }
    }

    void load()
    const id = setInterval(() => void load(), 20000)
    const unsubscribe = subscribeToRuntimeMutations(() => void load())
    return () => {
      mounted = false
      clearInterval(id)
      unsubscribe()
    }
  }, [])

  return (
    <div className="flex items-center gap-5 border-b border-slate-800 bg-[rgba(2,6,23,0.95)] px-8 py-2.5 text-xs text-slate-400 tabular-nums">
      {/* Status */}
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2 shrink-0">
          <span
            className={`absolute inset-0 rounded-full cc-pulse ${
              strip.runnerOnline ? "bg-emerald-500/40" : strip.runnerState === "starting" ? "bg-amber-500/40" : "bg-slate-500/40"
            }`}
          />
          <span
            className={`relative h-2 w-2 rounded-full ${
              strip.runnerOnline ? "bg-emerald-500" : strip.runnerState === "starting" ? "bg-amber-400" : "bg-slate-500"
            }`}
          />
        </span>
        <span className="font-medium text-slate-200">
          {strip.runnerOnline ? "Runner online" : strip.runnerState === "starting" ? "Starting runner..." : "Runner offline"}
        </span>
        <span className="opacity-40">·</span>
        <span>{strip.activeRunCount} active {strip.activeRunCount === 1 ? "run" : "runs"}</span>
        {strip.pendingDecisionCount > 0 ? (
          <>
            <span className="opacity-40">·</span>
            <span className="text-amber-300">{strip.pendingDecisionCount} {strip.pendingDecisionCount === 1 ? "decision" : "decisions"} pending</span>
          </>
        ) : null}
      </div>

      {/* Divider */}
      <div className="h-3 w-px bg-slate-800" />

      {/* Stats */}
      <div className="flex items-center gap-4 text-slate-500">
        <span>
          Last run <span className="text-slate-400">{strip.lastRunLabel}</span>
        </span>
        <span>
          Weekly usage <span className="text-slate-400">{strip.weeklyTokens}</span>
        </span>
        <span>
          Month spend <span className="text-slate-400">{strip.monthSpend}</span>
        </span>
      </div>

      {/* Right */}
      <div className="ml-auto flex items-center gap-3 text-slate-500">
        <span>v{strip.version}</span>
        {dateStamp ? <span className="text-[11px]">{dateStamp}</span> : null}
      </div>
    </div>
  )
}
