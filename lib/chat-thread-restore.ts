import type { ChatThreadMessage } from "@/lib/chat-thread-messages"

type ThreadPayload = {
  thread: {
    threadId: string
    messages: ChatThreadMessage[]
  } | null
}

type RestoreChatThreadOptions = {
  threadId?: string | null
  maxAttempts?: number
  delayMs?: number
  loadThread: () => Promise<ThreadPayload>
}

function sleep(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function restoreChatThreadWithRetry({
  threadId,
  maxAttempts = 3,
  delayMs = 150,
  loadThread,
}: RestoreChatThreadOptions) {
  const attempts = threadId ? Math.max(1, maxAttempts) : 1

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const payload = await loadThread()
    if (payload.thread?.threadId && payload.thread.messages?.length) {
      return payload
    }

    if (attempt < attempts) {
      await sleep(delayMs * attempt)
    }
  }

  return { thread: null }
}
