"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ProjectTabs } from "@/components/project-tabs"
import { executiveizeText } from "@/lib/executive"
import { formatRuntimeNotice } from "@/lib/runtime-event-types"
import type { ProjectStatus, RunTemplate } from "@/lib/project-status"
import { publishRuntimeMutation, subscribeToRuntimeMutations } from "@/lib/runtime-sync"

function toneForStatus(status: string) {
  if (status === "completed" || /build/i.test(status)) return "green"
  if (status === "cancelled") return "neutral"
  if (status === "healthy") return "green"
  if (status === "awaiting_ceo") return "purple"
  if (status === "stale_governance") return "amber"
  if (status === "blocked") return "red"
  if (status === "failed" || /critical|blocked/i.test(status)) return "red"
  if (status === "timed_out") return "amber"
  if (status === "running") return "purple"
  return "amber"
}

function toneForTrust(level: string) {
  if (level === "confirmed") return "green"
  if (level === "inferred") return "amber"
  return "red"
}

const presets = {
  continue: (projectName: string) =>
    `Continue ${projectName} using TASKS.md and the latest HANDOFF.md. Complete the highest-priority in-progress or up-next task, update governance files as needed, and verify what you changed.`,
  blocker: (projectName: string) =>
    `Investigate the top blocker in ${projectName}, propose the narrowest safe fix, implement it if appropriate, and update TASKS.md, ERRORS.md, and HANDOFF.md with the result.`,
  review: (projectName: string) =>
    `Review ${projectName}, identify the highest-priority next move, and update TASKS.md plus HANDOFF.md so the next session can continue cleanly.`,
  qa: (projectName: string) =>
    `Prepare ${projectName} for QA by reviewing the active implementation state, identifying missing verification steps, and updating QA_CHECKLIST.md, SECURITY_CHECKLIST.md, and HANDOFF.md with the current reality.`,
  investigate: (projectName: string) =>
    `Investigate the highest-priority blocker or trust gap in ${projectName}. Show what you checked, what you found, the most likely cause, the exact next fix, and apply a low-risk fix yourself if it is clearly safe.`,
}

const planStages = [
  { id: "queued", label: "Queued", description: "Assignment accepted and waiting to start." },
  { id: "reading_context", label: "Reading project context", description: "The worker is reading the repo and current project state." },
  { id: "planning", label: "Planning", description: "The worker is choosing the narrowest safe next move." },
  { id: "executing", label: "Executing", description: "The worker is carrying out the assignment now." },
  { id: "verifying", label: "Verifying", description: "The worker is checking that the result actually worked." },
  { id: "updating_governance", label: "Updating governance", description: "The worker is refreshing runtime, handoff, and project records." },
  { id: "done", label: "Done", description: "The assignment finished cleanly." },
] as const

const sections = [
  { id: "overview", label: "Overview", href: (projectName: string) => `/projects/${projectName}/overview` },
  { id: "work", label: "Work", href: (projectName: string) => `/projects/${projectName}/work` },
  { id: "log", label: "Log", href: (projectName: string) => `/projects/${projectName}/log` },
] as const

type ProjectView = (typeof sections)[number]["id"]

function stageLabel(stage?: string | null) {
  if (!stage) return "Unknown"
  if (stage === "blocked") return "Blocked"
  return planStages.find((item) => item.id === stage)?.label ?? stage.replaceAll("_", " ")
}

function stageState(currentStage?: string | null, stageId?: string) {
  if (!currentStage || !stageId) return "upcoming"
  if (currentStage === "blocked") return "blocked"
  const currentIndex = planStages.findIndex((item) => item.id === currentStage)
  const stageIndex = planStages.findIndex((item) => item.id === stageId)
  if (currentIndex === -1 || stageIndex === -1) return "upcoming"
  if (stageIndex < currentIndex) return "complete"
  if (stageIndex === currentIndex) return "current"
  return "upcoming"
}

export function ProjectOperator({
  projectName,
  initialProject,
  tabs,
  currentView,
  runnerAvailable,
}: {
  projectName: string
  initialProject: ProjectStatus
  tabs: Record<string, string>
  currentView: ProjectView
  runnerAvailable: boolean
}) {
  const router = useRouter()
  const [project, setProject] = useState<ProjectStatus | null>(initialProject)
  const [instruction, setInstruction] = useState(presets.continue(projectName))
  const [status, setStatus] = useState("")
  const [liveNotice, setLiveNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [jobActionLoading, setJobActionLoading] = useState<string | null>(null)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [decisionChoice, setDecisionChoice] = useState("")
  const [decisionNote, setDecisionNote] = useState("")
  const [decisionLoading, setDecisionLoading] = useState(false)
  const [expandedDecisionId, setExpandedDecisionId] = useState<string | null>(null)

  async function refreshProject() {
    const response = await fetch(`/api/projects/${projectName}`)
    if (!response.ok) {
      throw new Error(`Project refresh failed with status ${response.status}.`)
    }
    const payload = (await response.json()) as ProjectStatus
    setProject(payload)
    if (payload.ceoDecision?.options?.length) {
      setDecisionChoice((current) => current || payload.ceoDecision?.defaultOptionId || payload.ceoDecision?.options?.[0]?.id || "")
    }
  }

  useEffect(() => {
    let mounted = true

    async function loadProject() {
      try {
        const response = await fetch(`/api/projects/${projectName}`)
        if (!response.ok) {
          throw new Error(`Project refresh failed with status ${response.status}.`)
        }
        const payload = (await response.json()) as ProjectStatus
        if (mounted) {
          setProject(payload)
          if (payload.ceoDecision?.options?.length) {
            setDecisionChoice((current) => current || payload.ceoDecision?.defaultOptionId || payload.ceoDecision?.options?.[0]?.id || "")
          }
        }
      } catch (error) {
        if (mounted) {
          setStatus(error instanceof Error ? error.message : "Project refresh failed.")
        }
      }
    }

    void loadProject()
    const intervalMs = project?.jobs.some((job) => job.status === "running" || job.status === "queued") ? 12000 : 30000
    const id = window.setInterval(() => void loadProject(), intervalMs)
    const handleFocus = () => void loadProject()
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadProject()
      }
    }
    const unsubscribe = subscribeToRuntimeMutations((event) => {
      setLiveNotice(formatRuntimeNotice(event))
      if (event.scope === "portfolio" || event.projectName === projectName) {
        void loadProject()
        router.refresh()
      }
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
  }, [projectName, project?.jobs, router])

  const currentRun = useMemo(
    () => project?.jobs.find((job) => job.status === "running" || job.status === "queued") ?? null,
    [project],
  )
  const latestFinishedRun = useMemo(
    () => project?.jobs.find((job) => job.status !== "running" && job.status !== "queued") ?? null,
    [project],
  )
  const selectedDecisionOption = useMemo(
    () => project?.ceoDecision?.options?.find((option) => option.id === decisionChoice) ?? null,
    [decisionChoice, project],
  )

  const showOverview = currentView === "overview"
  const showWork = currentView === "work"
  const showLog = currentView === "log"

  async function launchRun(nextInstruction?: string, runTemplate: RunTemplate = "custom") {
    const resolvedInstruction = nextInstruction ?? instruction
    if (!resolvedInstruction.trim() || loading) return

    setLoading(true)
    setStatus("")

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "project_task",
          projectName,
          instruction: resolvedInstruction,
          runTemplate,
        }),
      })

      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to launch worker.")
      }

      await refreshProject()
      router.refresh()
      publishRuntimeMutation({ projectName, scope: "project", reason: "launch" })
      setInstruction(resolvedInstruction)
      setStatus(`Worker launched for ${projectName}.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unknown worker error.")
    } finally {
      setLoading(false)
    }
  }

  async function mutateJob(jobId: string, action: "cancel" | "retry") {
    setJobActionLoading(jobId)
    setStatus("")

    try {
      const response = await fetch("/api/runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action }),
      })

      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to ${action} job.`)
      }

      await refreshProject()
      router.refresh()
      publishRuntimeMutation({ projectName, scope: "project", reason: "job_update" })
      setStatus(action === "cancel" ? "Worker cancelled." : "Worker retried.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unknown job action error.")
    } finally {
      setJobActionLoading(null)
    }
  }

  async function submitDecision() {
    if (!decisionChoice || decisionLoading) return

    setDecisionLoading(true)
    setStatus("")

    try {
      const response = await fetch(`/api/projects/${projectName}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: decisionChoice,
          note: decisionNote,
        }),
      })

      const payload = (await response.json()) as { error?: string; summary?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to record decision.")
      }

      setDecisionNote("")
      await refreshProject()
      router.refresh()
      publishRuntimeMutation({ projectName, scope: "project", reason: "decision" })
      setStatus(payload.summary ?? "Decision recorded.")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unknown decision error.")
    } finally {
      setDecisionLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-sky-300">Project operating view</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">{projectName}</h2>
            <p className="mt-3 max-w-2xl text-sm text-slate-400">
              This page is now organized around what you need to know, what the system is doing, and the evidence trail behind it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={toneForStatus(project?.phase ?? "unknown") as never}>{project?.phase ?? "Loading"}</Badge>
            <Badge tone="neutral">{project?.progress ?? 0}% progress</Badge>
            {project?.runtimeState?.currentStage ? (
              <Badge tone={project.runtimeState.currentStage === "blocked" ? "red" : "purple"}>
                {stageLabel(project.runtimeState.currentStage)}
              </Badge>
            ) : null}
            <Badge tone={runnerAvailable ? "green" : "red"}>
              {runnerAvailable ? "Worker runner online" : "Worker runner offline"}
            </Badge>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          {sections.map((section) => (
            <Link
              key={section.id}
              href={section.href(projectName)}
              className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                currentView === section.id
                  ? "border-sky-400 bg-sky-500/10 text-sky-100"
                  : "border-slate-700 text-slate-300 hover:border-sky-400 hover:text-sky-200"
              }`}
            >
              {section.label}
            </Link>
          ))}
        </div>
        {liveNotice ? <p className="mt-4 text-sm text-amber-200">{liveNotice}</p> : null}
        {status ? <p className="mt-2 text-sm text-sky-300">{status}</p> : null}
      </div>

      {showOverview ? (
      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Overview</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">What matters right now</h3>
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Recommended next move</p>
                <p className="mt-2 text-sm leading-7 text-slate-200">{project?.nextAction ?? "Loading project status..."}</p>
                {project?.recommendedAction ? (
                  <p className="mt-2 text-xs leading-6 text-sky-300">
                    System recommendation: {project.recommendedAction.label}. {project.recommendedAction.reason}
                  </p>
                ) : null}
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Top blocker</p>
                <p className="mt-2 text-sm leading-7 text-slate-200">{project?.blocker ?? "Loading blocker..."}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Sprint goal</p>
                <p className="mt-2 text-sm leading-7 text-slate-300">{project?.sprintGoal ?? "Loading sprint goal..."}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Launch target</p>
                <p className="mt-2 text-sm leading-7 text-slate-300">{project?.launchTarget ?? "TBD"}</p>
              </div>
            </div>
          </Card>

          <Card className="space-y-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Project health</p>
            {project?.runtimeState ? (
              <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-100">Latest system reading</p>
                <Badge tone={toneForStatus(project.runtimeState.status) as never}>{project.runtimeState.statusLabel}</Badge>
              </div>
              <p className="text-sm text-slate-300">{project.runtimeState.summary}</p>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Trust status</p>
                  <Badge tone={toneForTrust(project.runtimeState.trust.level) as never}>{project.runtimeState.trust.level}</Badge>
                </div>
                <p className="mt-2 text-sm text-slate-300">{project.runtimeState.trust.headline}</p>
                <div className="mt-3 space-y-2">
                  {project.runtimeState.trust.checks.map((check) => (
                    <div key={`${check.label}-${check.source}`} className="rounded-lg border border-slate-800 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-slate-200">{check.label}</p>
                        <Badge tone={toneForTrust(check.status) as never}>{check.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Source: {check.source.replaceAll("_", " ")}</p>
                      <p className="mt-2 text-sm text-slate-400">{check.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
              {project.runtimeState.currentStage ? (
                <p className="text-xs text-sky-300">Current step: {stageLabel(project.runtimeState.currentStage)}</p>
              ) : null}
                <p className="text-xs text-slate-500">
                  Project record updated: {project.runtimeState.governanceUpdated ? "yes" : "no"}
                </p>
                {project.runtimeState.missingTargets.length ? (
                  <p className="text-xs text-amber-300">
                    The project record still needs a full refresh before it should be fully trusted.
                  </p>
                ) : null}
                {project.runtimeState.completedAt ? (
                  <p className="text-xs text-slate-500">Last update: {new Date(project.runtimeState.completedAt).toLocaleString()}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No reconciled runtime state yet.</p>
            )}
          </Card>
        </div>

        <Card className="space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Executive brief</p>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Current focus</p>
              {(project?.inProgress ?? []).length ? (
                <ul className="mt-2 space-y-2 text-sm text-slate-300">
                  {(project?.inProgress ?? []).slice(0, 3).map((item) => (
                    <li key={item}>{executiveizeText(item)}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-400">No in-progress task recorded.</p>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Coming up</p>
              {(project?.upNext ?? []).length ? (
                <ul className="mt-2 space-y-2 text-sm text-slate-300">
                  {(project?.upNext ?? []).slice(0, 3).map((item) => (
                    <li key={item}>{executiveizeText(item)}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-400">No up-next task recorded.</p>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Latest update</p>
              <p className="mt-2 text-sm leading-7 text-slate-300">
                {project?.latestHandoff.whatWorks || project?.latestHandoff.whatIsBroken || "No handoff summary yet."}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Active risk</p>
              <p className="mt-2 text-sm leading-7 text-slate-300">{project?.activeError.description || "No active error recorded."}</p>
              {project?.activeError.impact ? <p className="mt-1 text-sm text-slate-400">{project.activeError.impact}</p> : null}
            </div>
          </div>
        </Card>
      </section>
      ) : null}

      {showWork ? (
      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Work</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">What the system is doing</h3>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="space-y-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Current assignment</p>
            {currentRun ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-100">Work is in progress</p>
                    <p className="mt-2 text-sm text-slate-300">{currentRun.summary}</p>
                  </div>
                  <Badge tone={toneForStatus(currentRun.status) as never}>{currentRun.statusLabel}</Badge>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Assignment progress</p>
                    <Badge tone={currentRun.currentStage === "blocked" ? "red" : "purple"}>{stageLabel(currentRun.currentStage)}</Badge>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {planStages.map((stage) => {
                      const state = stageState(currentRun.currentStage, stage.id)
                      const isCurrent = state === "current"
                      const isComplete = state === "complete"
                      return (
                        <div
                          key={stage.id}
                          className={`rounded-xl border px-3 py-3 ${
                            isCurrent
                              ? "border-sky-400 bg-sky-500/10"
                              : isComplete
                                ? "border-emerald-500/30 bg-emerald-500/5"
                                : "border-slate-800 bg-slate-950/40"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className={`text-sm font-medium ${isCurrent ? "text-sky-200" : isComplete ? "text-emerald-200" : "text-slate-300"}`}>
                              {stage.label}
                            </p>
                            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                              {isCurrent ? "Current" : isComplete ? "Done" : "Next"}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-400">{stage.description}</p>
                        </div>
                      )
                    })}
                    {currentRun.currentStage === "blocked" ? (
                      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-3 md:col-span-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-red-100">Blocked</p>
                          <span className="text-xs uppercase tracking-[0.2em] text-red-200">Attention needed</span>
                        </div>
                        <p className="mt-2 text-sm text-red-100/90">The run stopped before completion and needs operator attention.</p>
                      </div>
                    ) : null}
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    Last step update: {new Date(currentRun.stageUpdatedAt ?? currentRun.createdAt).toLocaleString()}
                  </p>
                </div>
                {currentRun.commentaryPreview ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Live operator notes</p>
                    <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300">{currentRun.commentaryPreview}</pre>
                  </div>
                ) : null}

                <p className="text-xs text-slate-500">Started: {new Date(currentRun.createdAt).toLocaleString()}</p>
                {!runnerAvailable && currentRun.status === "queued" ? (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                    <p className="text-sm font-medium text-red-100">Why this is still queued</p>
                    <p className="mt-2 text-sm text-red-100/90">
                      The worker runner is offline, so this assignment is sitting in the queue with no active consumer. Bring the Inngest dev
                      runner back up before retrying or launching more work.
                    </p>
                  </div>
                ) : null}
                <div className="pt-2">
                  <Button
                    variant="destructive"
                    onClick={() => void mutateJob(currentRun.id, "cancel")}
                    disabled={jobActionLoading === currentRun.id}
                  >
                    {jobActionLoading === currentRun.id ? "Cancelling..." : "Cancel run"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-400">No active run right now.</p>
                {!runnerAvailable ? (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                    <p className="text-sm font-medium text-red-100">Execution is blocked right now</p>
                    <p className="mt-2 text-sm text-red-100/90">
                      The worker runner is offline. Status, decision-making, and past execution memory still load, but new work will queue until
                      the runner is back.
                    </p>
                  </div>
                ) : null}
                {latestFinishedRun ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-100">Latest outcome</p>
                      <Badge tone={toneForStatus(latestFinishedRun.status) as never}>{latestFinishedRun.statusLabel}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{latestFinishedRun.summary}</p>
                    <p className="mt-2 text-xs text-slate-500">Final step: {stageLabel(latestFinishedRun.currentStage)}</p>
                    {latestFinishedRun.executiveMessage ? (
                      <p className="mt-3 text-sm text-slate-300">{latestFinishedRun.executiveMessage}</p>
                    ) : null}
                    {latestFinishedRun.commentaryPreview ? (
                      <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-400">{latestFinishedRun.commentaryPreview}</pre>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Next move</p>
                <h4 className="mt-2 text-xl font-semibold text-white">Launch structured work</h4>
              </div>
              <Badge tone="purple">Autonomous worker</Badge>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                variant={project?.recommendedAction?.template === "investigate_issue" ? "default" : "outline"}
                onClick={() =>
                  void launchRun(project?.investigation?.suggestedInstruction || presets.investigate(projectName), "investigate_issue")
                }
                disabled={loading || Boolean(currentRun) || !runnerAvailable}
              >
                Investigate issue
              </Button>
              <Button
                variant={project?.recommendedAction?.template === "continue_project" ? "default" : "outline"}
                onClick={() => void launchRun(presets.continue(projectName), "continue_project")}
                disabled={loading || Boolean(currentRun) || !runnerAvailable}
              >
                Continue project
              </Button>
              <Button
                variant={project?.recommendedAction?.template === "fix_issue" || project?.recommendedAction?.template === "fix_blocker" ? "default" : "outline"}
                onClick={() => void launchRun(presets.blocker(projectName), "fix_issue")}
                disabled={loading || Boolean(currentRun) || !runnerAvailable}
              >
                Fix blocker
              </Button>
              <Button
                variant={project?.recommendedAction?.template === "review_next_move" ? "default" : "outline"}
                onClick={() => void launchRun(presets.review(projectName), "review_next_move")}
                disabled={loading || Boolean(currentRun) || !runnerAvailable}
              >
                Review next move
              </Button>
              <Button
                variant={project?.recommendedAction?.template === "prep_qa" ? "default" : "outline"}
                onClick={() => void launchRun(presets.qa(projectName), "prep_qa")}
                disabled={loading || Boolean(currentRun) || !runnerAvailable}
              >
                Prep QA
              </Button>
            </div>

            <Textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} className="min-h-32" />
            <div className="flex items-center gap-3">
              <Button onClick={() => void launchRun()} disabled={loading || !instruction.trim() || Boolean(currentRun) || !runnerAvailable}>
                {loading ? "Launching..." : currentRun ? "Worker already active" : !runnerAvailable ? "Runner offline" : "Launch custom worker"}
              </Button>
              {!runnerAvailable ? (
                <p className="text-xs text-red-300">Runner is offline, so execution is frozen until it reconnects.</p>
              ) : null}
            </div>
          </Card>
        </div>

        {project?.investigation ? (
          <Card className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">System investigation</p>
                <h4 className="mt-2 text-xl font-semibold text-white">{project.investigation.title}</h4>
              </div>
              <Badge tone={project.investigation.canAutofix ? "purple" : "amber"}>
                {project.investigation.autonomyMode === "needs_ceo_approval"
                  ? "Needs CEO review"
                  : project.investigation.autonomyMode === "needs_review"
                    ? "Needs review"
                    : "Can attempt fix"}
              </Badge>
            </div>
            <p className="text-sm text-slate-300">{project.investigation.summary}</p>
            {project.investigation.diagnosisCode ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Diagnosis</p>
                <p className="mt-3 text-sm leading-7 text-slate-300">{project.investigation.diagnosisCode}</p>
              </div>
            ) : null}
            {project.investigation.autonomyRationale ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Autonomy policy</p>
                <p className="mt-3 text-sm leading-7 text-slate-300">{project.investigation.autonomyRationale}</p>
              </div>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What the system checked</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  {project.investigation.checks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Likely cause</p>
                <p className="mt-3 text-sm leading-7 text-slate-300">{project.investigation.likelyCause}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Exact next fix</p>
                <p className="mt-3 text-sm leading-7 text-slate-300">{project.investigation.nextStep}</p>
              </div>
            </div>
            {project.investigation.evidence?.length ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Live evidence</p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {project.investigation.evidence.map((item) => (
                    <div key={`${item.label}-${item.detail}`} className="rounded-lg border border-slate-800 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-100">{item.label}</p>
                        <Badge tone={toneForTrust(item.status) as never}>{item.status}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">{item.detail}</p>
                      {item.url ? (
                        <Link href={item.url} className="mt-2 inline-flex text-xs text-sky-300" target="_blank">
                          Open evidence
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {project.investigation.proofSummary ? (
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Verified</p>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {project.investigation.proofSummary.verified.length ? (
                      project.investigation.proofSummary.verified.map((item) => <li key={item}>{item}</li>)
                    ) : (
                      <li>No verified proof captured yet.</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inferred</p>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {project.investigation.proofSummary.inferred.length ? (
                      project.investigation.proofSummary.inferred.map((item) => <li key={item}>{item}</li>)
                    ) : (
                      <li>No active inference is being carried right now.</li>
                    )}
                  </ul>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Blocked evidence</p>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    {project.investigation.proofSummary.blocked.length ? (
                      project.investigation.proofSummary.blocked.map((item) => <li key={item}>{item}</li>)
                    ) : (
                      <li>No blocked evidence lanes are currently identified.</li>
                    )}
                  </ul>
                </div>
              </div>
            ) : null}
            {project.investigation.recommendedAction ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Recommended remediation</p>
                <p className="mt-3 text-sm font-medium text-slate-100">{project.investigation.recommendedAction.kind}</p>
                <p className="mt-2 text-sm leading-7 text-slate-300">{project.investigation.recommendedAction.summary}</p>
              </div>
            ) : null}
            {project.investigation.deploymentDetails ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Latest deployment snapshot</p>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Branch</p>
                    <p className="mt-1 text-sm text-slate-100">{project.investigation.deploymentDetails.branch}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">State</p>
                    <p className="mt-1 text-sm text-slate-100">{project.investigation.deploymentDetails.state}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Commit</p>
                    <p className="mt-1 text-sm text-slate-100">{project.investigation.deploymentDetails.commitSha || "Unknown"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Created</p>
                    <p className="mt-1 text-sm text-slate-100">{project.investigation.deploymentDetails.createdAt || "Unknown"}</p>
                  </div>
                </div>
                {project.investigation.deploymentDetails.url ? (
                  <Link href={project.investigation.deploymentDetails.url} className="mt-3 inline-flex text-sm text-sky-300" target="_blank">
                    Open deployment
                  </Link>
                ) : null}
              </div>
            ) : null}
            {project.investigation.actions?.length ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Remediation actions</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  {project.investigation.actions.map((item) => (
                    <li key={`${item.kind}-${item.summary}`}>
                      {item.kind}: {item.summary}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void launchRun(project.investigation?.suggestedInstruction, "investigate_issue")}
                disabled={loading || Boolean(currentRun) || !runnerAvailable}
              >
                {loading ? "Launching..." : currentRun ? "Worker already active" : !runnerAvailable ? "Runner offline" : "Run investigation"}
              </Button>
              <p className="text-xs text-slate-500">
                This launches an evidence-first diagnosis run instead of guessing.
              </p>
            </div>
          </Card>
        ) : null}

        <Card className="space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Decision center</p>
          {project?.ceoDecision ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-100">{project.ceoDecision.title}</p>
                <Badge tone={project.ceoDecision.priority === "critical" ? "red" : "amber"}>{project.ceoDecision.priority}</Badge>
              </div>
              <p className="text-sm text-slate-300">{project.ceoDecision.reason}</p>
              {project.ceoDecision.explanation ? (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Why the system paused</p>
                  <p className="mt-2 text-sm leading-7 text-slate-300">{project.ceoDecision.explanation}</p>
                </div>
              ) : null}
              {project.ceoDecision.evidence?.length ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What the system found</p>
                  <ul className="mt-2 space-y-2 text-sm text-slate-300">
                    {project.ceoDecision.evidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-xs text-sky-300">Recommended next move: {project.ceoDecision.recommendation}</p>
              {project.ceoDecision.options?.length ? (
                <div className="space-y-3 rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-100">Make the decision here</p>
                    <Badge tone="purple">Action required</Badge>
                  </div>
                  <div className="space-y-3">
                    {project.ceoDecision.options.map((option) => {
                      const selected = decisionChoice === option.id
                      const expanded = expandedDecisionId === option.id
                      return (
                        <div
                          key={option.id}
                          className={`rounded-xl border p-4 transition-colors ${
                            selected
                              ? "border-sky-400 bg-sky-500/10"
                              : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setDecisionChoice(option.id)}
                            className="w-full text-left"
                          >
                            <p className="text-sm font-medium text-slate-100">{option.label}</p>
                            <p className="mt-2 text-sm text-slate-300">{option.description}</p>
                            {"summary" in option && option.summary ? (
                              <p className="mt-3 text-sm leading-7 text-slate-200">{option.summary}</p>
                            ) : null}
                            <p className="mt-3 text-xs leading-6 text-slate-400">{option.impact}</p>
                          </button>
                          <div className="mt-3 flex flex-wrap gap-3">
                            <Button variant={selected ? "default" : "outline"} onClick={() => setDecisionChoice(option.id)}>
                              {selected ? "Selected" : "Choose this path"}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => setExpandedDecisionId((current) => (current === option.id ? null : option.id))}
                            >
                              {expanded ? "Hide more detail" : "More detail"}
                            </Button>
                          </div>
                          {expanded ? (
                            <div className="mt-4 space-y-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                              {"whyThisMatters" in option && option.whyThisMatters ? (
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Executive explanation</p>
                                  <p className="mt-2 text-sm leading-7 text-slate-300">{option.whyThisMatters}</p>
                                </div>
                              ) : null}
                              {"workflow" in option && option.workflow?.length ? (
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">How this path works</p>
                                  <ul className="mt-2 space-y-2 text-sm text-slate-300">
                                    {option.workflow.map((item) => (
                                      <li key={item}>{item}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                              {"files" in option && option.files?.length ? (
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Main files involved</p>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {option.files.map((file) => (
                                      <span
                                        key={file}
                                        className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300"
                                      >
                                        {file}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {"risk" in option && option.risk ? (
                                <div>
                                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Key risk</p>
                                  <p className="mt-2 text-sm leading-7 text-amber-200">{option.risk}</p>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                  {selectedDecisionOption ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What happens next</p>
                      <p className="mt-2 text-sm leading-7 text-slate-300">{selectedDecisionOption.impact}</p>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Optional note for the next run</p>
                    <Textarea
                      value={decisionNote}
                      onChange={(event) => setDecisionNote(event.target.value)}
                      className="mt-2 min-h-24"
                      placeholder="Add any instruction you want preserved with this decision."
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={() => void submitDecision()} disabled={!decisionChoice || decisionLoading}>
                      {decisionLoading ? "Recording decision..." : "Record decision and unblock work"}
                    </Button>
                    <p className="text-xs text-slate-500">
                      This updates the project record immediately so the next worker can continue from your choice.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No decision is currently needed from you on this project.</p>
          )}
        </Card>
      </section>
      ) : null}

      {showLog ? (
      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Log</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">What happened and where to inspect it</h3>
        </div>

        <Card className="space-y-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Recent outcomes</p>
          {(project?.jobs ?? []).length ? (
            <div className="space-y-4">
              {(project?.jobs ?? []).slice(0, 6).map((job) => (
                <div key={job.id} className="rounded-xl border border-slate-800 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-100">{job.summary}</p>
                      {job.runTemplate ? <p className="mt-1 text-xs text-slate-500">Action type: {job.runTemplate.replaceAll("_", " ")}</p> : null}
                    </div>
                    <Badge tone={toneForStatus(job.status) as never}>{job.statusLabel}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-sky-300">Final step: {stageLabel(job.currentStage)}</p>
                  {job.executiveMessage ? <p className="mt-3 text-sm text-slate-300">{job.executiveMessage}</p> : null}
                  {job.commentaryPreview ? (
                    <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-400">{job.commentaryPreview}</pre>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-3">
                    {job.status === "failed" || job.status === "cancelled" || job.status === "timed_out" || job.status === "completed" ? (
                      <Button
                        variant="outline"
                        onClick={() => void mutateJob(job.id, "retry")}
                        disabled={Boolean(currentRun) || jobActionLoading === job.id}
                      >
                        {jobActionLoading === job.id ? "Retrying..." : "Retry run"}
                      </Button>
                    ) : null}
                    <Button variant="ghost" onClick={() => setExpandedJobId((current) => (current === job.id ? null : job.id))}>
                      {expandedJobId === job.id ? "Hide execution detail" : "Show execution detail"}
                    </Button>
                  </div>
                  {expandedJobId === job.id ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Requested work</p>
                      <p className="text-sm text-slate-300">{executiveizeText(job.instruction)}</p>
                      {job.successCriteria?.length ? (
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Success criteria</p>
                          <ul className="mt-2 space-y-2 text-sm text-slate-300">
                            {job.successCriteria.map((item) => (
                              <li key={item}>{executiveizeText(item)}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="mt-3 text-xs text-slate-500">
                    Started: {new Date(job.createdAt).toLocaleString()}
                    {job.completedAt ? ` · Finished: ${new Date(job.completedAt).toLocaleString()}` : ""}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No runs yet for this project.</p>
          )}
        </Card>

        <ProjectTabs projectName={projectName} tabs={tabs} />
      </section>
      ) : null}
    </div>
  )
}
