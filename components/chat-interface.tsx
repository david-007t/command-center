"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { buildChatRunEvent, type ChatRunEvent } from "@/lib/chat-run-thread"
import { buildProjectQuickActions } from "@/lib/project-chat-actions"
import { restoreChatThreadWithRetry } from "@/lib/chat-thread-restore"
import { defaultProjectThreadMessage, syncRunEventsIntoMessages, type ChatThreadMessage } from "@/lib/chat-thread-messages"
import type { JobStatus, RuntimeJobStage } from "@/lib/orchestration"
import { formatRuntimeNotice } from "@/lib/runtime-event-types"
import { subscribeToRuntimeMutations } from "@/lib/runtime-sync"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type RunPayload = {
  id: string
  projectName: string | null
  status: JobStatus
  currentStage: RuntimeJobStage
  createdAt: string
  stageUpdatedAt: string
  completedAt: string | null
  summary: string
  commentaryPreview: string
  messagePreview: string
  chatThreadId?: string | null
}

type ProjectStatus = {
  name: string
  phase: string
  runtimeStatus: string | null
  runtimeSummary: string | null
  commentaryPreview?: string | null
}

type FeedbackItem = {
  id: string
  scope: "system" | "project"
  projectName: string | null
  category: "self_heal" | "product_improvement" | "governance_fix" | "needs_decision"
  status: "logged" | "actioning" | "resolved" | "needs_decision"
  statusLabel: string
  scopeLabel: string
  summary: string
  resolutionNote: string | null
}

type ContextPackSummary = {
  generatedAt: string
  freshness: "fresh" | "stale"
  health: "healthy" | "watch" | "overloaded"
  approximateTokens: number
  summary: string
  recommendedNextMove: string
  architecture: string[]
  activeRisks: string[]
  compactedMemory?: string[]
  compressionRatio?: number
  compactionRecommendedAction?: string
}

type InvestigationSnapshot = {
  title: string
  summary: string
  likelyCause: string
  nextStep: string
  diagnosisCode?: string
  suggestedInstruction?: string
  recommendedAction?: {
    kind: string
    summary: string
  }
  proofSummary?: {
    verified: string[]
    inferred: string[]
    blocked: string[]
  }
  deploymentDetails?: {
    branch: string
    state: string
    commitSha: string | null
    url: string | null
    createdAt: string | null
  }
}

function toneForRuntime(status: string | null) {
  if (!status) return "neutral"
  if (/healthy/i.test(status)) return "green"
  if (/awaiting_ceo/i.test(status)) return "purple"
  if (/blocked/i.test(status)) return "red"
  if (/stale|timed_out/i.test(status)) return "amber"
  if (/cancelled/i.test(status)) return "neutral"
  return "amber"
}

export function ChatInterface({
  initialStatuses,
  initialFeedback,
  initialMessages,
  projectName,
  title,
  contextPack,
  investigation,
}: {
  initialStatuses: ProjectStatus[]
  initialFeedback: FeedbackItem[]
  initialMessages?: ChatThreadMessage[]
  projectName?: string
  title?: string
  contextPack?: ContextPackSummary
  investigation?: InvestigationSnapshot | null
}) {
  const [messages, setMessages] = useState<ChatThreadMessage[]>(
    initialMessages?.length
      ? initialMessages
      : [
          {
            id: "welcome",
            role: "assistant",
            content: projectName
              ? `${projectName} loaded. Ask for status, blocker, decision, why a job is queued, or say proceed to launch the recommended local action.`
              : "Portfolio chat is disabled during stabilization. Use a project chat or work view instead.",
            source: "chat",
          },
        ],
  )
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [statuses, setStatuses] = useState(initialStatuses)
  const [feedbackItems, setFeedbackItems] = useState(initialFeedback)
  const [chatThreadId, setChatThreadId] = useState<string | null>(null)
  const [threadRestored, setThreadRestored] = useState(false)
  const [liveNotice, setLiveNotice] = useState<string | null>(null)

  useEffect(() => {
    setStatuses(initialStatuses)
  }, [initialStatuses])

  useEffect(() => {
    setFeedbackItems(initialFeedback)
  }, [initialFeedback])

  useEffect(() => {
    if (!projectName) return
    const storageKey = `command-center-chat-thread:${projectName}`
    let cancelled = false

    async function restoreThread() {
      const existing = window.localStorage.getItem(storageKey)
      const payload = await restoreChatThreadWithRetry({
        threadId: existing,
        loadThread: async () => {
          const response = await fetch(existing ? `/api/chat/thread?project=${projectName}&threadId=${existing}` : `/api/chat/thread?project=${projectName}`)
          return (await response.json()) as { thread: { threadId: string; messages: ChatThreadMessage[] } | null }
        },
      })

      if (cancelled) return

      if (payload.thread?.threadId && payload.thread.messages?.length) {
        window.localStorage.setItem(storageKey, payload.thread.threadId)
        setChatThreadId(payload.thread.threadId)
        setMessages(payload.thread.messages)
        setThreadRestored(true)
        return
      }

      if (existing) {
        setChatThreadId(existing)
      } else {
        const created = window.crypto.randomUUID()
        window.localStorage.setItem(storageKey, created)
        setChatThreadId(created)
      }

      if (initialMessages?.length) {
        setMessages(initialMessages)
      } else {
        setMessages([defaultProjectThreadMessage(projectName!)])
      }
      setThreadRestored(true)
    }

    void restoreThread()

    return () => {
      cancelled = true
    }
  }, [projectName])

  useEffect(() => {
    if (!projectName || !chatThreadId || !threadRestored) return

    void fetch("/api/chat/thread", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectName,
        threadId: chatThreadId,
        messages,
      }),
    }).catch(() => null)
  }, [chatThreadId, messages, projectName, threadRestored])

  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshFeedback()
      void refreshRunEvents()
      void refreshStatuses()
    }, projectName ? 20000 : 30000)

    return () => window.clearInterval(id)
  }, [chatThreadId, projectName])

  useEffect(() => {
    void refreshRunEvents()
  }, [chatThreadId, projectName])

  useEffect(() => {
    const unsubscribe = subscribeToRuntimeMutations((event) => {
      setLiveNotice(formatRuntimeNotice(event))

      const isRelevantProject =
        !projectName ||
        event.scope === "portfolio" ||
        event.projectName === projectName

      void refreshFeedback()
      void refreshStatuses()

      if (isRelevantProject && (!chatThreadId || !event.chatThreadId || event.chatThreadId === chatThreadId || event.projectName === projectName)) {
        void refreshRunEvents()
      }
    })

    return unsubscribe
  }, [chatThreadId, projectName])

  async function refreshFeedback() {
    const response = await fetch(projectName ? `/api/feedback?project=${projectName}` : "/api/feedback")
    const payload = (await response.json()) as { feedback: FeedbackItem[] }
    setFeedbackItems(payload.feedback)
  }

  async function refreshStatuses() {
    if (projectName) {
      const response = await fetch(`/api/projects/${projectName}`)
      if (!response.ok) return

      const payload = (await response.json()) as {
        name: string
        phase: string
        runtimeState?: {
          status?: string | null
          summary?: string | null
        } | null
        commentaryPreview?: string | null
      }

      setStatuses([
        {
          name: payload.name,
          phase: payload.phase,
          runtimeStatus: payload.runtimeState?.status ?? null,
          runtimeSummary: payload.runtimeState?.summary ?? null,
          commentaryPreview: payload.commentaryPreview ?? null,
        },
      ])
      return
    }

    const response = await fetch("/api/portfolio")
    if (!response.ok) return
    const payload = (await response.json()) as { projects: ProjectStatus[] }
    setStatuses(payload.projects)
  }

  async function refreshRunEvents() {
    if (!projectName || !chatThreadId) return

    const response = await fetch(`/api/runs?project=${projectName}&chatThreadId=${chatThreadId}`)
    const payload = (await response.json()) as { jobs: RunPayload[] }
    const events: ChatRunEvent[] = payload.jobs
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((job) =>
        buildChatRunEvent(
          {
            id: job.id,
            projectName: job.projectName,
            chatThreadId: job.chatThreadId ?? null,
            status: job.status,
            createdAt: job.createdAt,
            completedAt: job.completedAt,
            summary: job.summary,
            currentStage: job.currentStage,
            stageUpdatedAt: job.stageUpdatedAt,
          },
          job.commentaryPreview,
          job.messagePreview,
        ),
      )

    setMessages((current) => syncRunEventsIntoMessages(current, events))
  }

  async function submit(nextPrompt?: string) {
    const prompt = nextPrompt ?? input.trim()
    if (!prompt || loading) return

    const nextMessages: ChatThreadMessage[] = [
      ...messages,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: prompt,
        source: "chat",
      },
    ]
    setMessages(nextMessages)
    setInput("")
    setLoading(true)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, projectName, chatThreadId }),
      })

      if (!response.body) {
        throw new Error("No response stream.")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let assistant = ""
      const assistantMessageId = `assistant-${Date.now()}`
      setMessages((current) => [...current, { id: assistantMessageId, role: "assistant", content: "", source: "chat" }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        assistant += decoder.decode(value, { stream: true })
        setMessages((current) => {
          return current.map((message) => (message.id === assistantMessageId ? { ...message, content: assistant } : message))
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown chat error."
      setMessages((current) => [
        ...current,
        { id: `assistant-error-${Date.now()}`, role: "assistant", content: `Chat failed: ${message}`, source: "chat" },
      ])
    } finally {
      void refreshFeedback()
      void refreshRunEvents()
      setLoading(false)
    }
  }

  const quickActions = useMemo(
    () =>
      projectName
        ? buildProjectQuickActions(projectName, investigation ?? null)
        : [
            "Run Scout",
            "Show me the projects waiting on CEO decisions",
            "What should I prioritize next?",
            ...statuses.map((status) => `Continue ${status.name}`),
          ],
    [investigation, projectName, statuses],
  )

  const attentionProjects = useMemo(
    () => statuses.filter((status) => status.runtimeStatus && status.runtimeStatus !== "healthy"),
    [statuses],
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-fit space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{projectName ? "Project context" : "Projects"}</p>
          {contextPack ? (
            <div className="mt-3 rounded-lg border border-slate-800 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-100">Context pack</p>
                <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                  {contextPack.health} · {contextPack.freshness}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400">{contextPack.summary}</p>
              <p className="mt-2 text-xs text-sky-300">{contextPack.recommendedNextMove}</p>
              <p className="mt-2 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                Approx context size: {contextPack.approximateTokens} tokens
              </p>
              {contextPack.compressionRatio ? (
                <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                  Compaction ratio: {contextPack.compressionRatio}x
                </p>
              ) : null}
              {contextPack.compactionRecommendedAction ? (
                <p className="mt-2 text-xs text-slate-500">{contextPack.compactionRecommendedAction}</p>
              ) : null}
              {contextPack.architecture.length ? (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Architecture memory</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-400">
                    {contextPack.architecture.slice(0, 3).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {contextPack.activeRisks.length ? (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Active risks</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-400">
                    {contextPack.activeRisks.slice(0, 2).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {contextPack.compactedMemory?.length ? (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Compacted run memory</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-400">
                    {contextPack.compactedMemory.slice(0, 3).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
          {investigation ? (
            <div className="mt-3 rounded-lg border border-slate-800 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-100">Active investigation</p>
                {investigation.diagnosisCode ? (
                  <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{investigation.diagnosisCode}</span>
                ) : null}
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400">{investigation.summary}</p>
              <p className="mt-2 text-xs text-slate-300">Likely cause: {investigation.likelyCause}</p>
              <p className="mt-2 text-xs text-sky-300">Next fix: {investigation.nextStep}</p>
              {investigation.recommendedAction ? (
                <p className="mt-2 text-xs text-slate-400">
                  Recommended remediation: {investigation.recommendedAction.kind} - {investigation.recommendedAction.summary}
                </p>
              ) : null}
              {investigation.deploymentDetails ? (
                <div className="mt-3 rounded-md bg-slate-950/60 p-3 text-xs text-slate-400">
                  <p>Deployment state: {investigation.deploymentDetails.state}</p>
                  <p>Branch: {investigation.deploymentDetails.branch}</p>
                  <p>Commit: {investigation.deploymentDetails.commitSha || "unknown"}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mt-3 space-y-2">
            {statuses.map((status) => (
              <div key={status.name} className="rounded-lg border border-slate-800 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-100">{status.name}</p>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-medium ${
                      toneForRuntime(status.runtimeStatus) === "green"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : toneForRuntime(status.runtimeStatus) === "purple"
                          ? "bg-fuchsia-500/15 text-fuchsia-300"
                          : toneForRuntime(status.runtimeStatus) === "red"
                            ? "bg-rose-500/15 text-rose-300"
                            : toneForRuntime(status.runtimeStatus) === "amber"
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {status.runtimeStatus ?? status.phase}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{status.phase}</p>
                {status.runtimeSummary ? <p className="mt-2 text-xs leading-5 text-slate-500">{status.runtimeSummary}</p> : null}
                {status.commentaryPreview ? (
                  <pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-500">{status.commentaryPreview}</pre>
                ) : null}
                {projectName ? (
                  <Link href={`/projects/${status.name}/work`} className="mt-3 inline-flex text-xs text-sky-300">
                    Open work view
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {!projectName ? (
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Needs attention</p>
          <div className="mt-3 space-y-2">
            {attentionProjects.length ? (
              attentionProjects.map((status) => (
                <button
                  key={status.name}
                  className="w-full rounded-lg border border-slate-800 p-3 text-left transition hover:bg-slate-900"
                  onClick={() => {
                    void submit(`What does ${status.name} need from me right now?`)
                  }}
                >
                  <p className="text-sm font-medium text-slate-100">{status.name}</p>
                  <p className="mt-1 text-xs text-slate-400">{status.runtimeStatus}</p>
                </button>
              ))
            ) : (
              <p className="text-sm text-slate-400">No projects are currently flagged for CEO attention.</p>
            )}
          </div>
        </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Quick actions</p>
          {quickActions.map((action) => (
            <Button
              key={action}
              className="w-full justify-start"
              variant="outline"
              onClick={() => {
                void submit(action)
              }}
            >
              {action}
            </Button>
          ))}
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Recent feedback</p>
          <div className="mt-3 space-y-2">
            {feedbackItems.length ? (
              feedbackItems.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-800 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-100">{item.scopeLabel}</p>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{item.statusLabel}</p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{item.summary}</p>
                  {item.resolutionNote ? <p className="mt-2 text-xs leading-5 text-sky-300">{item.resolutionNote}</p> : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No feedback has been logged yet.</p>
            )}
          </div>
        </div>
      </Card>

      <Card className="flex min-h-[70vh] flex-col">
        <div className="mb-4 border-b border-slate-800 pb-4">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{projectName ? "Project chat" : "Portfolio chat"}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{title ?? (projectName ? `${projectName} chat` : "CEO chat")}</h2>
          {liveNotice ? <p className="mt-3 text-sm text-sky-300">{liveNotice}</p> : null}
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.map((message, index) => (
            <div
              key={message.id ?? `${message.role}-${index}`}
              className={message.role === "assistant" ? "mr-8" : "ml-8"}
            >
              <div
                className={
                  message.role === "assistant"
                    ? message.source === "run_event"
                      ? "rounded-2xl rounded-tl-sm border border-slate-800 bg-slate-950/70 p-4 text-slate-100"
                      : "rounded-2xl rounded-tl-sm bg-slate-900 p-4 text-slate-100"
                    : "rounded-2xl rounded-tr-sm bg-sky-500/15 p-4 text-sky-100"
                }
              >
                <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-3">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder={
              projectName
                ? `Ask about ${projectName}, launch work, inspect blockers, or give project-specific feedback...`
                : "Ask for a decision, a priority call, a project outcome, or give feedback to improve the system..."
            }
          />
          <Button onClick={() => void submit()} disabled={loading}>
            {loading ? "Streaming..." : "Send"}
          </Button>
        </div>
      </Card>
    </div>
  )
}
