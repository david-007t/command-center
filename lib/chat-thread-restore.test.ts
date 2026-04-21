import test from "node:test"
import assert from "node:assert/strict"

import { restoreChatThreadWithRetry } from "./chat-thread-restore.ts"

test("restoreChatThreadWithRetry retries a missing thread before succeeding", async () => {
  let attempts = 0

  const result = await restoreChatThreadWithRetry({
    threadId: "thread-1",
    maxAttempts: 3,
    delayMs: 1,
    loadThread: async () => {
      attempts += 1
      if (attempts < 2) {
        return { thread: null }
      }

      return {
        thread: {
          threadId: "thread-1",
          messages: [{ id: "m1", role: "assistant", content: "Recovered", source: "chat" }],
        },
      }
    },
  })

  assert.equal(attempts, 2)
  assert.equal(result.thread?.threadId, "thread-1")
  assert.equal(result.thread?.messages.length, 1)
})

test("restoreChatThreadWithRetry does not retry when no thread id is present", async () => {
  let attempts = 0

  const result = await restoreChatThreadWithRetry({
    threadId: null,
    maxAttempts: 3,
    delayMs: 1,
    loadThread: async () => {
      attempts += 1
      return { thread: null }
    },
  })

  assert.equal(attempts, 1)
  assert.equal(result.thread, null)
})
