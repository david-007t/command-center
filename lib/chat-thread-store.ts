import { promises as fs } from "fs"
import path from "path"
import type { ChatThreadMessage } from "./chat-thread-messages"

export type StoredChatThread = {
  projectName: string
  threadId: string
  updatedAt: string
  messages: ChatThreadMessage[]
}

function runtimeStoreEnabled() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function threadFileName(projectName: string, threadId: string) {
  const safeProject = projectName.replace(/[^a-z0-9_-]/gi, "_")
  const safeThread = threadId.replace(/[^a-z0-9_-]/gi, "_")
  return `thread-${safeProject}-${safeThread}.json`
}

function messagesDir(developerPath: string) {
  return path.join(developerPath, "_system", "runtime", "messages")
}

export function getChatThreadPath(developerPath: string, projectName: string, threadId: string) {
  return path.join(messagesDir(developerPath), threadFileName(projectName, threadId))
}

export async function saveChatThread(
  developerPath: string,
  projectName: string,
  threadId: string,
  messages: ChatThreadMessage[],
) {
  if (runtimeStoreEnabled()) {
    const { saveChatThreadToStore } = await import("./runtime-store/phase1-store")
    return saveChatThreadToStore(projectName, threadId, messages, developerPath)
  }

  const existing = await readChatThread(developerPath, projectName, threadId)
  const knownRunEventJobIds = new Set(messages.filter((message) => message.source === "run_event" && message.jobId).map((message) => message.jobId as string))
  const preservedRunEvents =
    existing?.messages.filter(
      (message) => message.source === "run_event" && message.jobId && !knownRunEventJobIds.has(message.jobId),
    ) ?? []
  const next: StoredChatThread = {
    projectName,
    threadId,
    updatedAt: new Date().toISOString(),
    messages: [...messages, ...preservedRunEvents],
  }
  const filePath = getChatThreadPath(developerPath, projectName, threadId)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(next, null, 2) + "\n", "utf8")
  return next
}

export async function readChatThread(developerPath: string, projectName: string, threadId: string) {
  if (runtimeStoreEnabled()) {
    const { readChatThreadFromStore } = await import("./runtime-store/phase1-store")
    return readChatThreadFromStore(projectName, threadId, developerPath)
  }

  const raw = await fs.readFile(getChatThreadPath(developerPath, projectName, threadId), "utf8").catch(() => "")
  return raw ? (JSON.parse(raw) as StoredChatThread) : null
}

export async function readLatestChatThread(developerPath: string, projectName: string) {
  if (runtimeStoreEnabled()) {
    const { readLatestChatThreadFromStore } = await import("./runtime-store/phase1-store")
    return readLatestChatThreadFromStore(projectName, developerPath)
  }

  const dir = messagesDir(developerPath)
  const entries = await fs.readdir(dir).catch(() => [])
  const candidates = entries.filter((entry) => entry.startsWith(`thread-${projectName.replace(/[^a-z0-9_-]/gi, "_")}-`) && entry.endsWith(".json"))

  const threads = await Promise.all(
    candidates.map(async (entry) => {
      const raw = await fs.readFile(path.join(dir, entry), "utf8").catch(() => "")
      return raw ? (JSON.parse(raw) as StoredChatThread) : null
    }),
  )

  return threads
    .filter((thread): thread is StoredChatThread => Boolean(thread))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
}
