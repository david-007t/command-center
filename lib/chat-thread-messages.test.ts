import test from "node:test"
import assert from "node:assert/strict"
import { syncRunEventsIntoMessages, type ChatThreadMessage } from "./chat-thread-messages.ts"
import type { ChatRunEvent } from "./chat-run-thread.ts"

const baseMessages: ChatThreadMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "anelo loaded.",
    source: "chat",
  },
  {
    id: "user-1",
    role: "user",
    content: "Investigate anelo.",
    source: "chat",
  },
]

function makeEvent(overrides: Partial<ChatRunEvent> = {}): ChatRunEvent {
  return {
    jobId: "job_123",
    chatThreadId: "thread_anelo",
    projectName: "anelo",
    kind: "live",
    title: "Planning in progress",
    body: "What I checked\nGitHub and Vercel.",
    createdAt: "2026-04-15T18:00:00.000Z",
    updatedAt: "2026-04-15T18:01:00.000Z",
    status: "running",
    ...overrides,
  }
}

test("syncRunEventsIntoMessages appends a new run event into the chat thread", () => {
  const next = syncRunEventsIntoMessages(baseMessages, [makeEvent()])

  assert.equal(next.length, 3)
  assert.equal(next.at(-1)?.source, "run_event")
  assert.equal(next.at(-1)?.jobId, "job_123")
})

test("syncRunEventsIntoMessages updates an existing run event instead of duplicating it", () => {
  const first = syncRunEventsIntoMessages(baseMessages, [makeEvent()])
  const second = syncRunEventsIntoMessages(first, [
    makeEvent({
      kind: "final",
      title: "Verified outcome",
      body: "Outcome\nThe preview is now verified.",
      updatedAt: "2026-04-15T18:05:00.000Z",
      status: "completed",
    }),
  ])

  assert.equal(second.filter((message) => message.source === "run_event").length, 1)
  assert.equal(second.at(-1)?.content.includes("Verified outcome"), true)
})
