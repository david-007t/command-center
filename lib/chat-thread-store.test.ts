import test from "node:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { promises as fs } from "node:fs"
import { readChatThread, saveChatThread } from "./chat-thread-store.ts"
import type { ChatThreadMessage } from "./chat-thread-messages.ts"

test("saveChatThread preserves worker run events already written by the runtime", async () => {
  const developerPath = await fs.mkdtemp(path.join(os.tmpdir(), "command-center-chat-thread-"))
  const baseMessages: ChatThreadMessage[] = [
    {
      id: "welcome",
      role: "assistant",
      content: "anelo loaded.",
      source: "chat",
    },
  ]

  await saveChatThread(developerPath, "anelo", "thread-1", [
    ...baseMessages,
    {
      id: "run-job-1",
      role: "assistant",
      content: "Verified run result\nVerified outcome\n\nOutcome\nFixed it.",
      source: "run_event",
      jobId: "job-1",
      updatedAt: "2026-04-15T21:13:00.000Z",
    },
  ])

  await saveChatThread(developerPath, "anelo", "thread-1", [
    ...baseMessages,
    {
      id: "user-1",
      role: "user",
      content: "What changed?",
      source: "chat",
    },
  ])

  const saved = await readChatThread(developerPath, "anelo", "thread-1")
  assert.ok(saved)
  assert.equal(saved.messages.filter((message) => message.source === "run_event").length, 1)
  assert.equal(saved.messages.find((message) => message.jobId === "job-1")?.content.includes("Verified outcome"), true)
})
