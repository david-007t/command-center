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
import { buildFeedbackWorkOrderDraft } from "@/lib/feedback-work-order"
import type { ProjectStatus, RunTemplate } from "@/lib/project-status"
import { buildRunCeoBrief } from "@/lib/run-ceo-brief"
import { buildRunActivityView } from "@/lib/run-activity-view"
import { publishRuntimeMutation, subscribeToRuntimeMutations } from "@/lib/runtime-sync"
import { describeWorkOrderExecutionState } from "@/lib/work-order-execution-state"
import {
  activateMasterPlan,
  addSubPlan,
  clearActivePlan,
  emptyPlanStack,
  getActiveStoredPlan,
  isWorkOrderPlanStack,
  legacyPlanToStack,
  updateActivePlanRunId,
  updateActivePlanStatus,
  upsertMasterPlan,
  type StoredWorkOrderPlan,
  type WorkOrderPlanStack,
  type WorkOrderPlanStatus,
} from "@/lib/work-order-plan-stack"
import { buildWorkOrderPlan, createBlankWorkOrderDraft, type WorkOrderPlan, type WorkOrderPriority } from "@/lib/work-order-planner"

function toneForStatus(status: string) {
  if (status === "pending_ceo_test") return "purple"
  if (status === "worker_running") return "purple"
  if (status === "needs_record_refresh") return "amber"
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

function productLinkItems(project: ProjectStatus | null) {
  return [
    project?.deploymentLinks?.production
      ? {
          label: "Open production",
          href: project.deploymentLinks.production.url,
          note: "Live Vercel product.",
        }
      : null,
    project?.deploymentLinks?.stage
      ? {
          label: "Open stage",
          href: project.deploymentLinks.stage.url,
          note: "Vercel stage preview.",
        }
      : null,
    !project?.deploymentLinks?.production && !project?.deploymentLinks?.stage && project?.investigation?.deploymentDetails?.url
      ? {
          label: "Open latest deployment",
          href: project.investigation.deploymentDetails.url,
          note: "Latest deployment observed by the system.",
        }
      : null,
  ].filter((link): link is { label: string; href: string; note: string } => Boolean(link))
}

function primaryProductUrl(project: ProjectStatus | null) {
  return (
    project?.deploymentLinks?.production?.url ??
    project?.deploymentLinks?.stage?.url ??
    project?.investigation?.deploymentDetails?.url ??
    null
  )
}

function isDeploymentLink(
  link: ProjectStatus["deploymentLinks"]["production"] | ProjectStatus["deploymentLinks"]["stage"],
): link is NonNullable<ProjectStatus["deploymentLinks"]["production"] | ProjectStatus["deploymentLinks"]["stage"]> {
  return Boolean(link)
}

const commentaryDotColors: Record<string, string> = {
  read: "bg-sky-400",
  write: "bg-emerald-400",
  info: "bg-slate-400",
  verify: "bg-purple-400",
  warn: "bg-amber-400",
  error: "bg-rose-400",
}

function parseCommentaryLines(raw: string): Array<{ type: string; text: string }> {
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      if (/^(read|Reading)/i.test(line)) return { type: "read", text: line }
      if (/^(write|Write|Writing|Created|Modified)/i.test(line)) return { type: "write", text: line }
      if (/^(verify|Verify|Check|✓)/i.test(line)) return { type: "verify", text: line }
      if (/^(warn|WARN|Warning|⚠)/i.test(line)) return { type: "warn", text: line }
      if (/^(error|ERROR|Error|Failed|✗)/i.test(line)) return { type: "error", text: line }
      return { type: "info", text: line }
    })
}

function formatElapsed(isoStart: string): string {
  try {
    const secs = Math.floor((Date.now() - new Date(isoStart).getTime()) / 1000)
    if (secs < 60) return `${secs}s`
    const mins = Math.floor(secs / 60)
    if (mins < 60) return `${mins}m ${secs % 60}s`
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  } catch {
    return ""
  }
}

function formatTimestamp(value?: string | null) {
  if (!value) return "not recorded"
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

function FreshnessLine({
  label,
  updatedAt,
  source,
}: {
  label: string
  updatedAt?: string | null
  source?: string | null
}) {
  return (
    <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-slate-600">
      {label}: {formatTimestamp(updatedAt)}
      {source ? ` · ${source}` : ""}
    </p>
  )
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
type LegacyPersistedWorkOrderPlan = {
  goal: string
  context: string
  constraints: string
  acceptanceCriteria: string
  testPlan: string
  priority: WorkOrderPriority
  plan: WorkOrderPlan
  status: Exclude<WorkOrderPlanStatus, "draft">
  savedAt: string
}

function workOrderPlanStorageKey(projectName: string) {
  return `command-center.work-order-plan.${projectName}`
}

function workOrderPlanStackStorageKey(projectName: string) {
  return `command-center.work-order-plan-stack.${projectName}`
}

function isLegacyPersistedWorkOrderPlan(value: unknown): value is LegacyPersistedWorkOrderPlan {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<LegacyPersistedWorkOrderPlan>
  return (
    typeof candidate.goal === "string" &&
    typeof candidate.context === "string" &&
    typeof candidate.constraints === "string" &&
    typeof candidate.acceptanceCriteria === "string" &&
    typeof candidate.testPlan === "string" &&
    (candidate.priority === "urgent" || candidate.priority === "high" || candidate.priority === "normal") &&
    Boolean(candidate.plan) &&
    (candidate.status === "ready" || candidate.status === "approved" || candidate.status === "sent_back") &&
    typeof candidate.savedAt === "string"
  )
}

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

function RunCeoBriefPanel({
  job,
  projectName,
  productUrl,
  deploymentLinks,
  tabs,
}: {
  job: ProjectStatus["jobs"][number]
  projectName: string
  productUrl?: string | null
  deploymentLinks: ProjectStatus["deploymentLinks"]
  tabs: Record<string, string>
}) {
  const brief = buildRunCeoBrief(job, {
    projectName,
    productUrl,
    productLinks: [deploymentLinks.production, deploymentLinks.stage].filter(isDeploymentLink),
    qaChecklist: tabs.QA,
    securityChecklist: tabs.Security,
  })

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
      <div className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Status</p>
          <p className="mt-2 text-sm font-medium text-slate-100">{brief.status}</p>
          <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">Product links</p>
          <div className="mt-2 space-y-2">
            {brief.productLinks.map((link) => (
              <div key={`${link.label}-${link.href}`}>
                <Link href={link.href} target="_blank" className="inline-flex text-sm text-sky-300 hover:text-sky-200">
                  {link.label}
                </Link>
                <p className="mt-1 text-xs leading-5 text-slate-500">{link.note}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Bottom line</p>
            <p className="mt-2 text-sm leading-6 text-slate-100">{brief.bottomLine}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What changed</p>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
                {brief.whatChanged.slice(0, 3).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Ready to test</p>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
                {brief.whatToTest.slice(0, 3).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Still open</p>
              {brief.knownGaps.length ? (
                <ul className="mt-2 space-y-2 text-sm leading-6 text-amber-100">
                  {brief.knownGaps.slice(0, 3).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm leading-6 text-slate-300">No open gap was captured in the worker result.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AgentActivityPanel({
  job,
  runnerAvailable,
}: {
  job?: ProjectStatus["jobs"][number] | null
  runnerAvailable: boolean
}) {
  const activity = buildRunActivityView(job, runnerAvailable)
  return (
    <div className={`rounded-xl border p-4 ${activity.live ? "border-sky-500/30 bg-sky-500/10" : "border-slate-800 bg-slate-950/60"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{activity.heading}</p>
        <Badge tone={activity.live ? "green" : "neutral"}>{activity.live ? "Live" : "Not live"}</Badge>
      </div>
      {activity.showPreformatted ? (
        <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300">{activity.body}</pre>
      ) : (
        <p className="mt-3 text-sm leading-7 text-slate-300">{activity.body}</p>
      )}
      <p className="mt-2 text-xs text-slate-500">{activity.detail}</p>
    </div>
  )
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
  const [loading, setLoading] = useState(false)
  const [jobActionLoading, setJobActionLoading] = useState<string | null>(null)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [decisionChoice, setDecisionChoice] = useState("")
  const [decisionNote, setDecisionNote] = useState("")
  const [decisionLoading, setDecisionLoading] = useState(false)
  const [expandedDecisionId, setExpandedDecisionId] = useState<string | null>(null)
  const [runnerOnline, setRunnerOnline] = useState(runnerAvailable)
  const blankWorkOrderDraft = createBlankWorkOrderDraft()
  const [workOrderGoal, setWorkOrderGoal] = useState(blankWorkOrderDraft.goal)
  const [workOrderContext, setWorkOrderContext] = useState(blankWorkOrderDraft.context)
  const [workOrderConstraints, setWorkOrderConstraints] = useState(blankWorkOrderDraft.constraints)
  const [workOrderAcceptance, setWorkOrderAcceptance] = useState(blankWorkOrderDraft.acceptanceCriteria)
  const [workOrderTestPlan, setWorkOrderTestPlan] = useState(blankWorkOrderDraft.testPlan)
  const [workOrderPriority, setWorkOrderPriority] = useState<WorkOrderPriority>(blankWorkOrderDraft.priority)
  const [workOrderPlan, setWorkOrderPlan] = useState<WorkOrderPlan | null>(null)
  const [workOrderPlanStatus, setWorkOrderPlanStatus] = useState<WorkOrderPlanStatus>("draft")
  const [workOrderPlanSavedAt, setWorkOrderPlanSavedAt] = useState<string | null>(null)
  const [workOrderPlanStack, setWorkOrderPlanStack] = useState<WorkOrderPlanStack>(() => emptyPlanStack())
  const [testFeedback, setTestFeedback] = useState("")
  const [testExpectedBehavior, setTestExpectedBehavior] = useState("")
  const [workOrderAutonomy, setWorkOrderAutonomy] = useState<"full" | "ask" | "plan_only">("full")
  const [runnerState, setRunnerState] = useState<"online" | "starting" | "offline">(runnerAvailable ? "online" : "offline")

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

  function applyStoredWorkOrderPlan(plan: StoredWorkOrderPlan | null) {
    if (!plan) {
      const blankDraft = createBlankWorkOrderDraft()
      setWorkOrderGoal(blankDraft.goal)
      setWorkOrderContext(blankDraft.context)
      setWorkOrderConstraints(blankDraft.constraints)
      setWorkOrderAcceptance(blankDraft.acceptanceCriteria)
      setWorkOrderTestPlan(blankDraft.testPlan)
      setWorkOrderPriority(blankDraft.priority)
      setWorkOrderPlan(null)
      setWorkOrderPlanStatus("draft")
      setWorkOrderPlanSavedAt(null)
      return
    }

    setWorkOrderGoal(plan.goal)
    setWorkOrderContext(plan.context)
    setWorkOrderConstraints(plan.constraints)
    setWorkOrderAcceptance(plan.acceptanceCriteria)
    setWorkOrderTestPlan(plan.testPlan)
    setWorkOrderPriority(plan.priority)
    setWorkOrderPlan(plan.plan)
    setWorkOrderPlanStatus(plan.status)
    setWorkOrderPlanSavedAt(plan.savedAt)
    setInstruction(plan.plan.executionInstruction)
  }

  function saveWorkOrderPlanStack(nextStack: WorkOrderPlanStack) {
    setWorkOrderPlanStack(nextStack)
    window.localStorage.setItem(workOrderPlanStackStorageKey(projectName), JSON.stringify(nextStack))
  }

  function activeStoredWorkOrderPlan() {
    return getActiveStoredPlan(workOrderPlanStack)
  }

  function currentStoredWorkOrderPlan(
    kind: StoredWorkOrderPlan["kind"],
    plan: WorkOrderPlan,
    savedAt: string,
    existing?: StoredWorkOrderPlan | null,
  ): StoredWorkOrderPlan {
    return {
      id: existing?.kind === kind ? existing.id : `${kind}-${savedAt}`,
      kind,
      goal: workOrderGoal,
      context: workOrderContext,
      constraints: workOrderConstraints,
      acceptanceCriteria: workOrderAcceptance,
      testPlan: workOrderTestPlan,
      priority: workOrderPriority,
      plan,
      status: "ready",
      savedAt,
      lastRunId: existing?.kind === kind ? existing.lastRunId : null,
    }
  }

  useEffect(() => {
    let mounted = true
    async function loadRunnerHealth() {
      try {
        const response = await fetch("/api/runner-health", { cache: "no-store" })
        if (!response.ok) return
        const payload = (await response.json()) as { runnerAvailable?: boolean; runnerState?: "online" | "starting" | "offline" }
        let nextOnline = Boolean(payload.runnerAvailable)
        let nextState = payload.runnerState ?? (nextOnline ? "online" : "offline")
        if (!nextOnline) {
          const startResponse = await fetch("/api/runner-health", { method: "POST", cache: "no-store" }).catch(() => null)
          if (startResponse?.ok) {
            const started = (await startResponse.json()) as { runnerAvailable?: boolean; runnerState?: "online" | "starting" | "offline" }
            nextOnline = Boolean(started.runnerAvailable)
            nextState = started.runnerState ?? (nextOnline ? "online" : "starting")
          }
        }
        if (mounted) {
          setRunnerOnline(nextOnline)
          setRunnerState(nextState)
        }
      } catch {
        if (mounted) {
          setRunnerOnline(false)
          setRunnerState("offline")
        }
      }
    }

    void loadRunnerHealth()
    const id = window.setInterval(() => void loadRunnerHealth(), 10000)
    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [])

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

  useEffect(() => {
    try {
      const rawStack = window.localStorage.getItem(workOrderPlanStackStorageKey(projectName))
      if (rawStack) {
        const parsedStack = JSON.parse(rawStack) as unknown
        if (isWorkOrderPlanStack(parsedStack)) {
          setWorkOrderPlanStack(parsedStack)
          const activePlan = getActiveStoredPlan(parsedStack)
          applyStoredWorkOrderPlan(activePlan)
          setStatus(activePlan ? "Restored the active saved plan for review." : "Master plan is preserved. Create or select a plan to continue.")
          return
        }
        window.localStorage.removeItem(workOrderPlanStackStorageKey(projectName))
      }

      const rawPlan = window.localStorage.getItem(workOrderPlanStorageKey(projectName))
      if (!rawPlan) return
      const parsed = JSON.parse(rawPlan) as unknown
      if (!isLegacyPersistedWorkOrderPlan(parsed)) return

      const migratedStack = legacyPlanToStack(parsed)
      saveWorkOrderPlanStack(migratedStack)
      applyStoredWorkOrderPlan(getActiveStoredPlan(migratedStack))
      setStatus("Restored the saved master plan for review.")
    } catch {
      window.localStorage.removeItem(workOrderPlanStackStorageKey(projectName))
    }
  }, [projectName])

  const currentRun = useMemo(
    () => project?.jobs.find((job) => job.status === "running" || job.status === "queued") ?? null,
    [project],
  )
  const selectedStoredPlan = useMemo(() => getActiveStoredPlan(workOrderPlanStack), [workOrderPlanStack])
  const masterStoredPlan = workOrderPlanStack.masterPlan
  const activePlanKind = selectedStoredPlan?.kind ?? null
  const overviewProductLinks = useMemo(() => productLinkItems(project), [project])
  const latestFinishedRun = useMemo(
    () => project?.jobs.find((job) => job.status !== "running" && job.status !== "queued") ?? null,
    [project],
  )
  const latestFinishedRunForActivePlan = useMemo(() => {
    if (!selectedStoredPlan?.lastRunId) {
      const latestFinishedBelongsToSubPlan = workOrderPlanStack.subPlans.some((plan) => plan.lastRunId && plan.lastRunId === latestFinishedRun?.id)
      return selectedStoredPlan?.kind === "master" && latestFinishedBelongsToSubPlan ? null : latestFinishedRun
    }
    return latestFinishedRun?.id === selectedStoredPlan.lastRunId ? latestFinishedRun : null
  }, [latestFinishedRun, selectedStoredPlan, workOrderPlanStack.subPlans])
  const workOrderExecutionState = useMemo(
    () =>
      describeWorkOrderExecutionState({
        planStatus: workOrderPlanStatus,
        currentRun,
        latestFinishedRun: latestFinishedRunForActivePlan,
      }),
    [currentRun, latestFinishedRunForActivePlan, workOrderPlanStatus],
  )
  const workOrderInputsLocked = workOrderExecutionState.frozen
  const selectedDecisionOption = useMemo(
    () => project?.ceoDecision?.options?.find((option) => option.id === decisionChoice) ?? null,
    [decisionChoice, project],
  )

  const showOverview = currentView === "overview"
  const showWork = currentView === "work"
  const showLog = currentView === "log"

  async function launchRun(nextInstruction?: string, runTemplate: RunTemplate = "custom") {
    const resolvedInstruction = nextInstruction ?? instruction
    if (!resolvedInstruction.trim() || loading) return null

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

      const payload = (await response.json()) as { error?: string; job?: { id?: string } }
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to launch worker.")
      }

      await refreshProject()
      router.refresh()
      publishRuntimeMutation({ projectName, scope: "project", reason: "launch" })
      setInstruction(resolvedInstruction)
      setStatus(`Worker launched for ${projectName}.`)
      return payload.job?.id ?? null
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unknown worker error.")
      return null
    } finally {
      setLoading(false)
    }
  }

  function createWorkOrderPlan() {
    if (!workOrderGoal.trim()) {
      setStatus("Add a goal before creating the plan.")
      return
    }

    const plan = buildWorkOrderPlan({
      projectName,
      goal: workOrderGoal,
      context: workOrderContext,
      constraints: workOrderConstraints,
      acceptanceCriteria: workOrderAcceptance,
      testPlan: workOrderTestPlan,
      priority: workOrderPriority,
    })

    setWorkOrderPlan(plan)
    setWorkOrderPlanStatus("ready")
    setInstruction(plan.executionInstruction)
    const savedAt = new Date().toISOString()
    setWorkOrderPlanSavedAt(savedAt)
    const existingPlan = activeStoredWorkOrderPlan()
    const kind = existingPlan?.kind === "sub_plan" ? "sub_plan" : "master"
    const storedPlan = currentStoredWorkOrderPlan(kind, plan, savedAt, existingPlan)
    const nextStack = kind === "sub_plan" ? addSubPlan(workOrderPlanStack, storedPlan) : upsertMasterPlan(workOrderPlanStack, storedPlan)
    saveWorkOrderPlanStack(nextStack)
    setStatus(kind === "sub_plan" ? "Sub-plan updated. Review and approve it before execution." : "Master plan created. Review and approve it before execution.")
  }

  function createFeedbackFixPlan() {
    if (!testFeedback.trim()) {
      setStatus("Describe what you saw before creating a fix plan.")
      return
    }
    if (currentRun || workOrderExecutionState.frozen) return

    const draft = buildFeedbackWorkOrderDraft({
      projectName,
      feedback: testFeedback,
      expectedBehavior: testExpectedBehavior,
      productUrl: primaryProductUrl(project),
      priority: "high",
    })
    const plan = buildWorkOrderPlan({
      projectName,
      ...draft,
    })
    const savedAt = new Date().toISOString()

    setWorkOrderGoal(draft.goal)
    setWorkOrderContext(draft.context)
    setWorkOrderConstraints(draft.constraints)
    setWorkOrderAcceptance(draft.acceptanceCriteria)
    setWorkOrderTestPlan(draft.testPlan)
    setWorkOrderPriority(draft.priority)
    setWorkOrderPlan(plan)
    setWorkOrderPlanStatus("ready")
    setWorkOrderPlanSavedAt(savedAt)
    setInstruction(plan.executionInstruction)
    const nextStack = addSubPlan(workOrderPlanStack, {
      id: `sub_plan-${savedAt}`,
      kind: "sub_plan",
      goal: draft.goal,
      context: draft.context,
      constraints: draft.constraints,
      acceptanceCriteria: draft.acceptanceCriteria,
      testPlan: draft.testPlan,
      priority: draft.priority,
      plan,
      status: "ready",
      savedAt,
      lastRunId: null,
    })
    saveWorkOrderPlanStack(nextStack)
    setStatus("Feedback converted into a sub-plan. The master plan is still preserved.")
  }

  async function approveAndLaunchPlan() {
    if (!workOrderPlan || loading || currentRun || !runnerOnline) return
    setWorkOrderPlanStatus("approved")
    const savedAt = new Date().toISOString()
    setWorkOrderPlanSavedAt(savedAt)
    const approvedStack = updateActivePlanStatus(workOrderPlanStack, "approved", savedAt)
    saveWorkOrderPlanStack(approvedStack)
    const jobId = await launchRun(workOrderPlan.executionInstruction, "custom")
    if (jobId) {
      saveWorkOrderPlanStack(updateActivePlanRunId(approvedStack, jobId))
    }
  }

  async function continueApprovedPlan() {
    if (!workOrderPlan || loading || currentRun || !runnerOnline || !workOrderExecutionState.canContinue) return

    const continuationInstruction = `${workOrderPlan.executionInstruction}

Continuation context:
- Plan type: ${activePlanKind === "master" ? "master plan" : activePlanKind === "sub_plan" ? "sub-plan" : "saved plan"}.
- Continue this same approved plan. Do not ask the CEO to recreate or reapprove it.
- Previous run status: ${latestFinishedRun?.status ?? "unknown"}.
- Previous run summary: ${latestFinishedRun?.summary ?? "No previous summary captured."}
- Previous worker message: ${latestFinishedRun?.messagePreview || latestFinishedRun?.logPreview || "No previous worker detail captured."}
- First inspect the current repo state and existing uncommitted changes, then finish only what remains from the approved plan.
- Return with product link, what changed, what to test, what remains, and whether the plan is complete.`

    const jobId = await launchRun(continuationInstruction, "custom")
    if (jobId) {
      saveWorkOrderPlanStack(updateActivePlanRunId(workOrderPlanStack, jobId))
    }
  }

  function sendBackPlan() {
    setWorkOrderPlanStatus("sent_back")
    if (workOrderPlan) {
      const savedAt = new Date().toISOString()
      setWorkOrderPlanSavedAt(savedAt)
      saveWorkOrderPlanStack(updateActivePlanStatus(workOrderPlanStack, "sent_back", savedAt))
    }
    setStatus("Plan sent back. Edit the work order and create a new plan.")
  }

  function clearSavedWorkOrderPlan() {
    const nextStack = clearActivePlan(workOrderPlanStack)
    saveWorkOrderPlanStack(nextStack)
    applyStoredWorkOrderPlan(getActiveStoredPlan(nextStack))
    setStatus(nextStack.masterPlan ? "Active plan cleared. The master plan is still available." : "Saved plan cleared. Create a new plan when ready.")
  }

  function continueMasterPlan() {
    if (!workOrderPlanStack.masterPlan || currentRun || workOrderExecutionState.frozen) return
    const nextStack = activateMasterPlan(workOrderPlanStack)
    saveWorkOrderPlanStack(nextStack)
    applyStoredWorkOrderPlan(getActiveStoredPlan(nextStack))
    setStatus("Master plan restored. Continue from the preserved roadmap when ready.")
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
    <div>
      {/* Page header */}
      <div className="-mx-8 -mt-7 mb-8 border-b border-slate-800 bg-[rgba(2,6,23,0.95)] px-8 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Link href="/projects" className="transition-colors hover:text-slate-300">Projects</Link>
              <span>/</span>
              <span className="text-slate-300">{projectName}</span>
            </div>
            <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-white">{projectName}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={toneForStatus(project?.phase ?? "unknown") as never}>{project?.phase ?? "Loading"}</Badge>
            <Badge tone="neutral">{project?.progress ?? 0}%</Badge>
            {project?.operatingState ? (
              <Badge tone={project.operatingState.tone as never}>{project.operatingState.label}</Badge>
            ) : null}
            <Badge tone={runnerOnline ? "emerald" : runnerState === "starting" ? "amber" : "red"}>
              {runnerOnline ? "Runner online" : runnerState === "starting" ? "Starting runner..." : "Runner offline"}
            </Badge>
          </div>
        </div>
        <div className="flex">
          {sections.map((section) => (
            <Link
              key={section.id}
              href={section.href(projectName)}
              className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                currentView === section.id
                  ? "border-sky-400 text-sky-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {section.label}
            </Link>
          ))}
        </div>
      </div>

      {status ? <p className="mb-4 text-sm text-sky-300">{status}</p> : null}

      {showOverview ? (
      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Overview</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">What matters right now</h3>
          <p className="mt-2 text-xs text-slate-500">
            Dashboard reading generated: {formatTimestamp(project?.freshness?.generatedAt)}
          </p>
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <Card className="space-y-5">
            {project?.operatingState ? (
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Current project state</p>
                  <Badge tone={project.operatingState.tone as never}>{project.operatingState.label}</Badge>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-100">{project.operatingState.summary}</p>
              </div>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Recommended next move</p>
                <p className="mt-2 text-sm leading-7 text-slate-200">
                  {project?.operatingState?.nextAction ?? project?.nextAction ?? "Loading project status..."}
                </p>
                <FreshnessLine
                  label="Source"
                  source={project?.freshness?.sources.runtime.label ?? project?.freshness?.sources.portfolio.label}
                  updatedAt={project?.freshness?.sources.runtime.updatedAt ?? project?.freshness?.sources.portfolio.updatedAt}
                />
                {project?.recommendedAction ? (
                  <p className="mt-2 text-xs leading-6 text-sky-300">
                    System recommendation: {project.recommendedAction.label}. {project.recommendedAction.reason}
                  </p>
                ) : null}
                <div className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Test links</p>
                  {overviewProductLinks.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {overviewProductLinks.map((link) => (
                        <Link
                          key={`${link.label}-${link.href}`}
                          href={link.href}
                          target="_blank"
                          className="inline-flex items-center rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-200 hover:border-sky-400/60 hover:text-sky-100"
                        >
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-amber-100">
                      No Vercel product link is connected yet.
                    </p>
                  )}
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    These links refresh from Vercel with the project status.
                  </p>
                  <FreshnessLine
                    label="Links refreshed"
                    source={project?.freshness?.sources.deploymentLinks.label}
                    updatedAt={project?.freshness?.sources.deploymentLinks.updatedAt ?? project?.freshness?.generatedAt}
                  />
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Top blocker</p>
                <p className="mt-2 text-sm leading-7 text-slate-200">
                  {project?.operatingState?.blocker ?? project?.blocker ?? "Loading blocker..."}
                </p>
                <FreshnessLine
                  label="Source"
                  source={project?.freshness?.sources.runtime.label ?? project?.freshness?.sources.portfolio.label}
                  updatedAt={project?.freshness?.sources.runtime.updatedAt ?? project?.freshness?.sources.portfolio.updatedAt}
                />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Sprint goal</p>
                <p className="mt-2 text-sm leading-7 text-slate-300">{project?.sprintGoal ?? "Loading sprint goal..."}</p>
                <FreshnessLine label="Source" source={project?.freshness?.sources.tasks.label} updatedAt={project?.freshness?.sources.tasks.updatedAt} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Launch target</p>
                <p className="mt-2 text-sm leading-7 text-slate-300">{project?.launchTarget ?? "TBD"}</p>
                <FreshnessLine label="Source" source={project?.freshness?.sources.portfolio.label} updatedAt={project?.freshness?.sources.portfolio.updatedAt} />
              </div>
            </div>
          </Card>

          <Card className="space-y-4">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Project health</p>
            {project?.runtimeState ? (
              <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-100">Latest system reading</p>
                <Badge tone={(project.operatingState?.tone ?? toneForStatus(project.runtimeState.status)) as never}>
                  {project.operatingState?.label ?? project.runtimeState.statusLabel}
                </Badge>
              </div>
              <p className="text-sm text-slate-300">{project.operatingState?.summary ?? project.runtimeState.summary}</p>
              {project.operatingState?.status === "pending_ceo_test" ? (
                <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What is still unverified</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Product-flow QA is waiting on your test. Internal project records refresh automatically in the background.
                  </p>
                </div>
              ) : (
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
              )}
              {project.runtimeState.currentStage ? (
                <p className="text-xs text-sky-300">Current step: {stageLabel(project.runtimeState.currentStage)}</p>
              ) : null}
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Freshness</p>
                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    Runtime: {formatTimestamp(project.freshness?.sources.runtime.updatedAt)} · job #{project.freshness?.sources.runtime.jobId?.slice(-6) ?? "none"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Latest run: {formatTimestamp(project.freshness?.sources.jobs.updatedAt)} · job #{project.freshness?.sources.jobs.jobId?.slice(-6) ?? "none"}
                  </p>
                  {project.freshness?.sources.runtime.jobId && project.freshness?.sources.jobs.jobId && project.freshness.sources.runtime.jobId !== project.freshness.sources.jobs.jobId ? (
                    <p className="mt-2 text-xs leading-5 text-amber-300">
                      Runtime and latest run disagree. This page is showing the latest run as the safer live source.
                    </p>
                  ) : null}
                </div>
                {project.operatingState?.status !== "pending_ceo_test" ? (
                  <>
                    <p className="text-xs text-slate-500">
                      Project record updated: {project.runtimeState.governanceUpdated ? "yes" : "no"}
                    </p>
                    {project.runtimeState.missingTargets.length ? (
                      <p className="text-xs text-amber-300">
                        The system is refreshing the project record automatically.
                      </p>
                    ) : null}
                  </>
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
              <FreshnessLine label="Source" source={project?.freshness?.sources.handoff.label} updatedAt={project?.freshness?.sources.handoff.updatedAt} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Active risk</p>
              <p className="mt-2 text-sm leading-7 text-slate-300">{project?.activeError.description || "No active error recorded."}</p>
              {project?.activeError.impact ? <p className="mt-1 text-sm text-slate-400">{project.activeError.impact}</p> : null}
              <FreshnessLine label="Source" source={project?.freshness?.sources.errors.label} updatedAt={project?.freshness?.sources.errors.updatedAt} />
            </div>
          </div>
        </Card>
      </section>
      ) : null}

      {showWork ? (
      <section className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">

          {/* ── Left column ─────────────────────────────────────── */}
          <div className="space-y-6">

            {/* Agent activity card */}
            <div className={`rounded-2xl border p-5 ${currentRun ? "border-sky-500/25 bg-sky-500/5" : "border-slate-800 bg-slate-950/70"}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">Agent activity</p>
                {currentRun ? (
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inset-0 rounded-full cc-pulse bg-sky-500/40" />
                      <span className="relative h-2 w-2 rounded-full bg-sky-500" />
                    </span>
                    <span className="text-xs font-medium text-sky-300">Live · {formatElapsed(currentRun.createdAt)}</span>
                  </div>
                ) : (
                  <span className="text-xs text-slate-600">Idle</span>
                )}
              </div>

              {currentRun ? (
                <div className="mt-4 space-y-4">
                  {/* Step progress rail */}
                  <div className="flex items-center gap-1">
                    {planStages.map((stage) => {
                      const state = stageState(currentRun.currentStage, stage.id)
                      return (
                        <div
                          key={stage.id}
                          title={stage.label}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            state === "complete" ? "bg-emerald-500" :
                            state === "current" ? "bg-sky-400" :
                            "bg-slate-800"
                          }`}
                        />
                      )
                    })}
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <Badge tone={currentRun.currentStage === "blocked" ? "red" : "purple"}>
                      {stageLabel(currentRun.currentStage)}
                    </Badge>
                    <div className="flex gap-2">
                      <Button variant="outline" disabled>Pause</Button>
                      <Button
                        variant="destructive"
                        onClick={() => void mutateJob(currentRun.id, "cancel")}
                        disabled={jobActionLoading === currentRun.id}
                      >
                        {jobActionLoading === currentRun.id ? "Cancelling…" : "Cancel"}
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-sm leading-6 text-slate-300">{currentRun.summary}</p>
                  </div>

                  {currentRun.commentaryPreview ? (
                    <div className="rounded-xl border border-slate-800 bg-[#060d1a] p-3">
                      <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-slate-600">Live output</p>
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        {parseCommentaryLines(currentRun.commentaryPreview).map((line, i) => (
                          <div key={i} className="flex items-start gap-2 py-0.5">
                            <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${commentaryDotColors[line.type] ?? "bg-slate-400"}`} />
                            <span className="font-mono text-xs leading-5 text-slate-300">{line.text}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1 font-mono">
                        <span className="text-xs text-slate-600">›</span>
                        <span className="inline-block h-3.5 w-1.5 bg-slate-500 cc-blink" />
                      </div>
                    </div>
                  ) : null}

                  {!runnerOnline && currentRun.status === "queued" ? (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                      <p className="text-sm font-medium text-red-100">
                        {runnerState === "starting" ? "Starting runner — assignment is queued" : "Runner offline — assignment is queued"}
                      </p>
                      <p className="mt-1 text-xs text-red-100/80">
                        {runnerState === "starting" ? "Command Center is starting the Inngest dev runner now." : "Bring the Inngest dev runner back up to resume."}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-slate-400">No active run right now.</p>
                  {!runnerOnline ? (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                      <p className="text-sm font-medium text-red-100">{runnerState === "starting" ? "Starting runner" : "Runner offline"}</p>
                      <p className="mt-1 text-xs text-red-100/80">
                        {runnerState === "starting" ? "Command Center is starting the Inngest dev runner now." : "New work will queue until the runner reconnects."}
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Last run brief */}
            {latestFinishedRun ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">Last run brief</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">#{latestFinishedRun.id.slice(-6)}</span>
                    <Badge tone={toneForStatus(latestFinishedRun.status) as never}>{latestFinishedRun.statusLabel}</Badge>
                  </div>
                </div>
                {(() => {
                  const brief = buildRunCeoBrief(latestFinishedRun, {
                    projectName,
                    productUrl: primaryProductUrl(project),
                    productLinks: ([project?.deploymentLinks?.production, project?.deploymentLinks?.stage] as Array<ProjectStatus["deploymentLinks"]["production"]>).filter(isDeploymentLink),
                    qaChecklist: tabs.QA,
                    securityChecklist: tabs.Security,
                  })
                  return (
                    <div className="mt-4 space-y-4">
                      <p className="text-[18px] font-medium leading-7 text-slate-100">{brief.bottomLine}</p>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                          <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400">What changed</p>
                          <ul className="mt-2 space-y-1.5 text-sm leading-5 text-slate-300">
                            {brief.whatChanged.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </div>
                        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
                          <p className="text-[10px] uppercase tracking-[0.2em] text-sky-400">What to test</p>
                          <ul className="mt-2 space-y-1.5 text-sm leading-5 text-slate-300">
                            {brief.whatToTest.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </div>
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                          <p className="text-[10px] uppercase tracking-[0.2em] text-amber-400">Still open</p>
                          {brief.knownGaps.length ? (
                            <ul className="mt-2 space-y-1.5 text-sm leading-5 text-slate-300">
                              {brief.knownGaps.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                            </ul>
                          ) : (
                            <p className="mt-2 text-sm text-slate-500">None captured.</p>
                          )}
                        </div>
                      </div>
                      {brief.productLinks.length ? (
                        <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                          {brief.productLinks.map((link) => (
                            <Link
                              key={link.href}
                              href={link.href}
                              target="_blank"
                              className="inline-flex items-center rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-300 transition-colors hover:border-sky-400/50"
                            >
                              {link.label}
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                })()}
              </div>
            ) : null}
          </div>

          {/* ── Right column ─────────────────────────────────────── */}
          <div className="space-y-6">

            {/* Next assignment card */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">Next assignment</p>
                <Badge tone={workOrderPlanStatus === "ready" || workOrderPlanStatus === "approved" ? "sky" : "slate"}>
                  {activePlanKind === "sub_plan" ? "Sub-plan" : activePlanKind === "master" ? "Master" : workOrderPlanStatus === "approved" ? "Approved" : workOrderPlanStatus === "ready" ? "Ready" : "Draft"}
                </Badge>
              </div>

              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Master plan</p>
                    {masterStoredPlan ? (
                      <>
                        <p className="mt-1 truncate text-sm font-medium text-slate-200">{masterStoredPlan.plan.title}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {selectedStoredPlan?.id === masterStoredPlan.id ? "Currently active" : "Preserved while sub-plans run"} · {masterStoredPlan.status.replaceAll("_", " ")}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-slate-500">No master plan saved yet.</p>
                    )}
                  </div>
                  {masterStoredPlan && selectedStoredPlan?.id !== masterStoredPlan.id ? (
                    <Button
                      variant="outline"
                      className="shrink-0 text-xs"
                      onClick={continueMasterPlan}
                      disabled={loading || Boolean(currentRun) || workOrderExecutionState.frozen}
                    >
                      Continue master
                    </Button>
                  ) : null}
                </div>
              </div>

              {/* Feedback intake */}
              <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
                <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-rose-400">Something broke?</p>
                <Textarea
                  value={testFeedback}
                  onChange={(event) => setTestFeedback(event.target.value)}
                  placeholder="Describe what you saw…"
                  className="min-h-16 border-rose-500/20 bg-transparent text-sm"
                  disabled={Boolean(currentRun) || workOrderExecutionState.frozen}
                />
                <Button
                  className="mt-2 w-full"
                  variant="outline"
                  onClick={createFeedbackFixPlan}
                  disabled={loading || Boolean(currentRun) || workOrderExecutionState.frozen}
                >
                  Convert to sub-plan
                </Button>
              </div>

              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-800" />
                <span className="text-[11px] text-slate-600">or compose directly</span>
                <div className="h-px flex-1 bg-slate-800" />
              </div>

              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Goal</span>
                  <Textarea
                    value={workOrderGoal}
                    onChange={(event) => setWorkOrderGoal(event.target.value)}
                    className="min-h-20 text-sm"
                    disabled={workOrderInputsLocked}
                  />
                </label>

                {/* Priority segmented control */}
                <div>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Priority</span>
                  <div className="mt-1.5 flex overflow-hidden rounded-lg border border-slate-800">
                    {(["urgent", "high", "normal"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setWorkOrderPriority(p)}
                        disabled={workOrderInputsLocked}
                        className={`flex-1 py-2 text-xs font-medium capitalize transition-colors disabled:opacity-50 ${
                          workOrderPriority === p
                            ? p === "urgent"
                              ? "bg-rose-500/20 text-rose-300"
                              : p === "high"
                                ? "bg-amber-500/15 text-amber-300"
                                : "bg-slate-800 text-slate-200"
                            : "text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Autonomy segmented control */}
                <div>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Autonomy</span>
                  <div className="mt-1.5 flex overflow-hidden rounded-lg border border-slate-800">
                    {([
                      { id: "full" as const, label: "Full" },
                      { id: "ask" as const, label: "Ask first" },
                      { id: "plan_only" as const, label: "Plan only" },
                    ]).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setWorkOrderAutonomy(opt.id)}
                        disabled={workOrderInputsLocked}
                        className={`flex-1 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                          workOrderAutonomy === opt.id
                            ? "bg-sky-500/15 text-sky-300"
                            : "text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Acceptance criteria</span>
                  <Textarea
                    value={workOrderAcceptance}
                    onChange={(event) => setWorkOrderAcceptance(event.target.value)}
                    placeholder="One requirement per line."
                    className="min-h-20 text-sm"
                    disabled={workOrderInputsLocked}
                  />
                </label>
              </div>

              {/* Action buttons */}
              <div className="mt-4 flex gap-2">
                <Button
                  className="flex-1"
                  onClick={createWorkOrderPlan}
                  disabled={loading || Boolean(currentRun) || workOrderExecutionState.frozen}
                >
                  {activePlanKind === "sub_plan" ? "Update sub-plan" : workOrderPlan ? "Update master plan" : "Create master plan"}
                </Button>
                {workOrderPlan && !workOrderExecutionState.complete ? (
                  workOrderExecutionState.canContinue ? (
                    <Button onClick={() => void continueApprovedPlan()} disabled={loading || Boolean(currentRun) || !runnerOnline}>
                      {loading ? "Launching…" : "Continue"}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => void approveAndLaunchPlan()}
                      disabled={loading || Boolean(currentRun) || !runnerOnline || workOrderExecutionState.frozen}
                    >
                      {loading ? "Launching…" : !runnerOnline ? "Offline" : "Approve & launch"}
                    </Button>
                  )
                ) : null}
              </div>

              {workOrderPlan ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={sendBackPlan}
                    disabled={loading || Boolean(currentRun) || workOrderExecutionState.frozen}
                  >
                    Send back
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 text-xs"
                    onClick={clearSavedWorkOrderPlan}
                    disabled={loading || Boolean(currentRun) || workOrderExecutionState.frozen}
                  >
                    {activePlanKind === "sub_plan" ? "Clear sub-plan" : "New plan"}
                  </Button>
                </div>
              ) : null}

              {!runnerOnline ? (
                <p className="mt-2 text-xs text-red-300">
                  {runnerState === "starting" ? "Starting runner — execution will unlock when it reconnects." : "Runner offline — execution frozen until reconnect."}
                </p>
              ) : null}

              {workOrderPlan ? (
                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-amber-200">{workOrderExecutionState.label}</p>
                    <Badge tone={workOrderExecutionState.complete ? "emerald" : workOrderExecutionState.frozen ? "amber" : "sky"}>
                      {workOrderExecutionState.complete ? "Done" : workOrderExecutionState.frozen ? "Locked" : "Editable"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{workOrderExecutionState.reason}</p>
                  {workOrderPlanSavedAt ? (
                    <p className="mt-1 text-[10px] text-slate-600">Saved {new Date(workOrderPlanSavedAt).toLocaleString()}</p>
                  ) : null}
                  {activePlanKind === "sub_plan" && masterStoredPlan ? (
                    <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-600">Master plan preserved</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Recent assignments */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
              <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">Recent assignments</p>
              {(project?.jobs ?? []).length ? (
                <div className="mt-3 space-y-2">
                  {(project?.jobs ?? []).slice(0, 6).map((job) => (
                    <div key={job.id} className="flex items-center gap-3 rounded-lg border border-slate-800 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-200">{job.summary}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          #{job.id.slice(-6)} · {new Date(job.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={toneForStatus(job.status) as never}>{job.statusLabel}</Badge>
                        {job.status === "failed" || job.status === "cancelled" || job.status === "timed_out" || job.status === "completed" ? (
                          <Button
                            variant="ghost"
                            onClick={() => void mutateJob(job.id, "retry")}
                            disabled={Boolean(currentRun) || jobActionLoading === job.id}
                          >
                            {jobActionLoading === job.id ? "…" : "Retry"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No assignments yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Plan review (full detail, shown when plan exists) */}
        {workOrderPlan ? (
          <div className="space-y-4 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Plan review</p>
                <h4 className="mt-2 text-lg font-semibold text-white">{workOrderPlan.title}</h4>
                <p className="mt-1 text-sm text-amber-200">{workOrderPlan.executionGate}</p>
              </div>
              <div className="flex gap-2">
                <Badge tone="purple">{workOrderPlan.customPercent}% custom</Badge>
                <Badge tone="emerald">{workOrderPlan.leveragedPercent}% leveraged</Badge>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Requested work</p>
                <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-300">
                  {workOrderPlan.requestSummary.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Do not break</p>
                <ul className="mt-2 space-y-1.5 text-sm leading-6 text-slate-300">
                  {workOrderPlan.doNotBreak.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Execution steps</p>
              <div className="grid gap-2">
                {workOrderPlan.steps.map((step, index) => (
                  <div key={step.title} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                    <span className="mt-0.5 shrink-0 text-xs text-slate-600">{index + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-100">{step.title}</p>
                        <Badge tone={step.owner === "CEO" ? "purple" : step.owner === "SDK worker" ? "emerald" : "neutral"}>{step.owner}</Badge>
                      </div>
                      <p className="mt-1 text-sm leading-5 text-slate-400">{step.outcome}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

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
                disabled={loading || Boolean(currentRun) || !runnerOnline}
              >
                {loading ? "Launching..." : currentRun ? "Worker already active" : !runnerOnline ? "Runner offline" : "Run investigation"}
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
                  <RunCeoBriefPanel
                    job={job}
                    projectName={projectName}
                    productUrl={primaryProductUrl(project)}
                    deploymentLinks={project?.deploymentLinks ?? { production: null, stage: null }}
                    tabs={tabs}
                  />
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
                      {job.commentaryPreview ? (
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Activity trace</p>
                          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs leading-5 text-slate-400">
                            {job.commentaryPreview}
                          </pre>
                        </div>
                      ) : null}
                      {job.rawMessagePreview || job.messagePreview || job.logPreview ? (
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Raw worker output</p>
                          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs leading-5 text-slate-400">
                            {job.rawMessagePreview || job.messagePreview || job.logPreview}
                          </pre>
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
