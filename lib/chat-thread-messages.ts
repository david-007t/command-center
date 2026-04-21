import type { ChatRunEvent } from "./chat-run-thread.ts"

export type ChatThreadMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  source: "chat" | "run_event"
  jobId?: string
  updatedAt?: string
}

export function defaultProjectThreadMessage(projectName: string) {
  return {
    id: "welcome",
    role: "assistant" as const,
    content: `${projectName} loaded. Ask about the architecture, current blockers, what to do next, launch work for this project, or give feedback specific to this project.`,
    source: "chat" as const,
  }
}

function renderRunEvent(event: ChatRunEvent) {
  const badge = event.kind === "live" ? "Operator run" : "Verified run result"
  return `${badge}\n${event.title}\n\n${event.body}`.trim()
}

export function syncRunEventsIntoMessages(messages: ChatThreadMessage[], events: ChatRunEvent[]) {
  const next = [...messages]

  for (const event of events) {
    const existingIndex = next.findIndex((message) => message.source === "run_event" && message.jobId === event.jobId)
    const rendered = renderRunEvent(event)

    if (existingIndex >= 0) {
      next[existingIndex] = {
        ...next[existingIndex],
        role: "assistant",
        content: rendered,
        updatedAt: event.updatedAt,
      }
      continue
    }

    next.push({
      id: `run-${event.jobId}`,
      role: "assistant",
      content: rendered,
      source: "run_event",
      jobId: event.jobId,
      updatedAt: event.updatedAt,
    })
  }

  return next
}
