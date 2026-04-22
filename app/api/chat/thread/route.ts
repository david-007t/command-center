import { NextResponse } from "next/server"
import { readChatThread, readLatestChatThread, saveChatThread } from "@/lib/chat-thread-store"
import type { ChatThreadMessage } from "@/lib/chat-thread-messages"
import { getDeveloperPath } from "@/lib/orchestration"
import { recordThreadMessageCreated } from "@/lib/runtime-events"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const developerPath = getDeveloperPath()
  const url = new URL(request.url)
  const projectName = url.searchParams.get("project")
  const threadId = url.searchParams.get("threadId")

  if (!projectName) {
    return NextResponse.json({ error: "project is required." }, { status: 400 })
  }

  const thread = threadId
    ? await readChatThread(developerPath, projectName, threadId)
    : await readLatestChatThread(developerPath, projectName)

  return NextResponse.json({ thread })
}

export async function PUT(request: Request) {
  const developerPath = getDeveloperPath()
  const body = (await request.json()) as {
    projectName?: string
    threadId?: string
    messages?: ChatThreadMessage[]
  }

  if (!body.projectName || !body.threadId || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "projectName, threadId, and messages are required." }, { status: 400 })
  }

  const previousThread = await readChatThread(developerPath, body.projectName, body.threadId)
  const thread = await saveChatThread(developerPath, body.projectName, body.threadId, body.messages)

  const previousLastId = previousThread?.messages.at(-1)?.id ?? null
  const nextLastId = body.messages.at(-1)?.id ?? null
  if (nextLastId && nextLastId !== previousLastId) {
    await recordThreadMessageCreated({
      projectName: body.projectName,
      chatThreadId: body.threadId,
      messageCount: body.messages.length,
    }).catch(() => null)
  }

  return NextResponse.json({ thread })
}
