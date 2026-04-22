"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import type { OperationsRunOutput } from "@/lib/operations-run-output"
import type { OperationsLiveData } from "@/lib/operations-live-data"

function timeAgo(iso: string | null | undefined) {
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

function stageLabel(stage?: string | null) {
  if (!stage) return "Unknown"
  return stage.replaceAll("_", " ")
}

function toneForRun(status: string) {
  if (status === "running") return "sky"
  if (status === "queued") return "amber"
  if (status === "completed") return "emerald"
  if (status === "awaiting_ceo") return "purple"
  if (status === "timed_out" || status === "failed") return "rose"
  return "slate"
}

function isLiveStatus(status: string) {
  return status === "running" || status === "queued"
}

function sourceLabel(source?: OperationsRunOutput["source"]) {
  if (source === "commentary") return "terminal"
  if (source === "execution_log") return "execution log"
  if (source === "message_preview") return "message preview"
  return "waiting"
}

function PulseDot({ live }: { live: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {live ? <span className="absolute inset-0 rounded-full cc-pulse bg-sky-400/40" /> : null}
      <span className={`relative h-2 w-2 rounded-full ${live ? "bg-sky-400" : "bg-amber-400"}`} />
    </span>
  )
}

export function OperationsPageClient({
  initialData,
  initialProject,
  initialRun,
}: {
  initialData: OperationsLiveData
  initialProject?: string | null
  initialRun?: string | null
}) {
  const router = useRouter()
  const [data, setData] = useState(initialData)
  const [lastRefresh, setLastRefresh] = useState(new Date().toISOString())
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(initialProject ?? null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRun ?? null)
  const [liveOutputByRun, setLiveOutputByRun] = useState<Record<string, OperationsRunOutput>>({})

  async function refresh() {
    const response = await fetch("/api/operations", { cache: "no-store" })
    if (!response.ok) return
    const payload = (await response.json()) as OperationsLiveData
    setData(payload)
    setLastRefresh(payload.generatedAt ?? new Date().toISOString())
  }

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), data.activeRuns.length ? 8000 : 15000)
    const handleFocus = () => void refresh()
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      window.clearInterval(id)
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [data.activeRuns.length])

  const runningByProject = useMemo(() => {
    const projects = new Map(data.projects.map((project) => [project.name, project]))
    return [...data.activeRuns, ...(data.recentRuns ?? [])].map((run) => ({
      run,
      project: run.projectName ? projects.get(run.projectName) ?? null : null,
    }))
  }, [data.activeRuns, data.projects, data.recentRuns])
  const selected =
    runningByProject.find(({ run }) => run.id === selectedRunId) ??
    runningByProject.find(({ run }) => run.projectName === selectedProjectName) ??
    runningByProject[0] ??
    null
  const liveOutput = selected ? liveOutputByRun[selected.run.id] : null

  async function refreshSelectedOutput(runId: string) {
    const response = await fetch(`/api/operations/output?runId=${encodeURIComponent(runId)}`, { cache: "no-store" })
    if (!response.ok) return
    const payload = (await response.json()) as OperationsRunOutput
    setLiveOutputByRun((current) => ({ ...current, [runId]: payload }))
  }

  useEffect(() => {
    if (!selected?.run.id) return
    const runId = selected.run.id
    void refreshSelectedOutput(runId)
    if (!isLiveStatus(selected.run.status)) return
    const id = window.setInterval(() => void refreshSelectedOutput(runId), 2500)
    return () => window.clearInterval(id)
  }, [selected?.run.id, selected?.run.status])

  function selectRun(projectName: string | null, runId: string) {
    setSelectedProjectName(projectName)
    setSelectedRunId(runId)
    const params = new URLSearchParams()
    if (projectName) params.set("project", projectName)
    params.set("run", runId)
    router.replace(`/operations?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-5">
        <div>
          <p className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-slate-500">Operations</p>
          <h1 className="mt-1.5 text-[30px] font-semibold leading-none tracking-[-0.025em] text-slate-50">
            Live worker board
          </h1>
          <p className="mt-1.5 text-[13px] text-slate-400">
            {data.activeRuns.length
              ? `${data.activeRuns.length} active worker${data.activeRuns.length > 1 ? "s" : ""} across ${new Set(data.activeRuns.map((run) => run.projectName ?? "system")).size} scope${data.activeRuns.length > 1 ? "s" : ""}.`
              : (data.recentRuns ?? []).length
                ? `${data.recentRuns.length} recently finished worker${data.recentRuns.length > 1 ? "s" : ""}.`
                : "No agents are running right now."}
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          className="rounded-lg border border-slate-700 bg-transparent px-3.5 py-2 text-[12.5px] font-medium text-slate-300 hover:border-slate-600"
        >
          Refresh
        </button>
      </div>

      <div className="rounded-[14px] border border-slate-800 bg-slate-900/70 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-slate-500">Current state</p>
            <p className="mt-1.5 text-sm font-medium text-slate-200">
              {data.activeRuns.length ? "Workers are live" : (data.recentRuns ?? []).length ? "Recent results available" : "Nothing available"}
            </p>
          </div>
          <p className="text-[11.5px] tabular-nums text-slate-500">Updated {timeAgo(lastRefresh)}</p>
        </div>
      </div>

      {runningByProject.length ? (
        <div className="grid gap-4 xl:grid-cols-[0.95fr_1.25fr]">
          <div className="space-y-3.5">
          {runningByProject.map(({ run, project }) => {
            const live = isLiveStatus(run.status)
            return (
              <button
                key={run.id}
                type="button"
                onClick={() => selectRun(run.projectName, run.id)}
                className={`group w-full rounded-[14px] border p-5 text-left transition-colors ${
                  selected?.run.id === run.id
                    ? "border-sky-500/45 bg-sky-500/10"
                    : "border-slate-800 bg-slate-900/70 hover:border-sky-500/35 hover:bg-slate-900"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <PulseDot live={live} />
                      <p className="text-[17px] font-semibold tracking-[-0.015em] text-slate-100 group-hover:text-sky-200">
                        {run.projectName ?? "system"}
                      </p>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-slate-400">
                      {live ? run.summary || run.instruction : run.oneLineResult || run.summary}
                    </p>
                  </div>
                  <Badge tone={toneForRun(run.status) as never}>{run.statusLabel}</Badge>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600">Step</p>
                    <p className="mt-1 text-sm text-slate-300">{stageLabel(run.currentStage)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600">Started</p>
                    <p className="mt-1 text-sm tabular-nums text-slate-300">{timeAgo(run.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600">Heartbeat</p>
                    <p className="mt-1 text-sm tabular-nums text-slate-300">{timeAgo(run.stageUpdatedAt ?? run.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600">Project</p>
                    <p className="mt-1 text-sm text-slate-300">{project?.phase ?? "Tracked"}</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3">
                  <span className="font-mono text-[11px] text-slate-600">#{run.id.slice(-6)}</span>
                  <span className="text-xs font-medium text-sky-300 group-hover:text-sky-200">
                    {live ? "Show activity" : "Show result"}
                  </span>
                </div>
              </button>
            )
          })}
          </div>

          <div className="rounded-[14px] border border-sky-500/25 bg-slate-950/70 p-5">
            {selected ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-slate-500">Agent activity</p>
                    <h2 className="mt-1.5 text-xl font-semibold text-slate-100">{selected.run.projectName ?? "system"}</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Updated {timeAgo(selected.run.stageUpdatedAt ?? selected.run.completedAt ?? selected.run.createdAt)} · #{selected.run.id.slice(-6)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={toneForRun(selected.run.status) as never}>{selected.run.statusLabel}</Badge>
                    {selected.run.projectName ? (
                      <Link
                        href={`/projects/${selected.run.projectName}/work`}
                        className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-sky-500/40 hover:text-sky-200"
                      >
                        Work page
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600">State</p>
                    <p className="mt-1 text-sm text-slate-200">{stageLabel(selected.run.currentStage)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600">Started</p>
                    <p className="mt-1 text-sm tabular-nums text-slate-200">{timeAgo(selected.run.createdAt)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600">Heartbeat</p>
                    <p className="mt-1 text-sm tabular-nums text-slate-200">{timeAgo(selected.run.stageUpdatedAt ?? selected.run.completedAt ?? selected.run.createdAt)}</p>
                  </div>
                </div>

                {!isLiveStatus(selected.run.status) ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                    <p className="text-[10.5px] uppercase tracking-[0.22em] text-slate-500">Result</p>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {selected.run.oneLineResult || "Worker finished and recorded a result."}
                    </p>
                  </div>
                ) : null}

                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10.5px] uppercase tracking-[0.22em] text-slate-500">Live output</p>
                    <p className="text-[11px] tabular-nums text-slate-500">
                      {sourceLabel(liveOutput?.source)} · updated {timeAgo(liveOutput?.updatedAt ?? liveOutput?.generatedAt)}
                    </p>
                  </div>
                  <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-[12.5px] leading-6 text-slate-300">
                    {liveOutput?.output || "Waiting for terminal output..."}
                  </pre>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                  <p className="text-[10.5px] uppercase tracking-[0.22em] text-slate-500">Assignment</p>
                  <p className="mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-400">
                    {selected.run.instruction}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="rounded-[14px] border border-slate-800 bg-slate-900/70 p-8 text-center">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.22em] text-slate-500">Live board</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-100">Nothing available</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Start a worker from any project. When LeadQual, Anelo, or another project is running, it will appear here as a live card with a direct link into that project’s work page.
          </p>
          <Link
            href="/projects"
            className="mt-5 inline-flex rounded-lg border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-sm font-medium text-sky-300 hover:border-sky-400/50"
          >
            Open projects
          </Link>
        </div>
      )}
    </div>
  )
}
