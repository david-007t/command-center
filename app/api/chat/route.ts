import { buildProjectRunSpec, launchJob, listJobs } from "@/lib/orchestration"
import { applyProjectDecision } from "@/lib/project-decision"
import { getImplicitProjectLaunch } from "@/lib/project-chat-launch"
import {
  buildProjectDecisionExplanationReply,
  buildProjectDecisionReply,
  buildProjectStatusReply,
  detectDecisionSelection,
  isLikelyDecisionExplanationRequest,
  isLikelyDecisionRequest,
  isLikelyStatusRequest,
} from "@/lib/project-chat-status"
import { buildProjectNeedsReply, buildProjectStatusReplyWithRunner, buildWorkerRunnerUnavailableReply, isLikelyProjectNeedsRequest, isLikelyQueueBlockerRequest } from "@/lib/project-chat-core"
import { getProjectStatus } from "@/lib/project-status"
import { isLocalWorkerRunnerAvailable } from "@/lib/dev-runner-health"
import { readChatThread, saveChatThread } from "@/lib/chat-thread-store"
import { recordThreadMessageCreated } from "@/lib/runtime-events"

type Message = {
  role: "user" | "assistant"
  content: string
}

function textResponse(text: string, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  })
}

function blockedOnConfigMessage(projectName: string, projectStatus: Awaited<ReturnType<typeof getProjectStatus>>) {
  const blocker = projectStatus.runtimeState?.configBlocker
  const credential = blocker?.credential ?? "required configuration"
  const detail = blocker?.detail ?? projectStatus.investigation?.summary ?? "A required credential or config value is missing."
  const nextStep = blocker?.nextStep ?? projectStatus.investigation?.nextStep ?? "Resolve the config gap, then re-run the worker."

  return `${projectName} is blocked on config.\n\nMissing: ${credential}\nWhy this is blocked: ${detail}\nNext step: ${nextStep}\n\nI will not re-launch this worker until that config gap is resolved or you give a new direction.`
}

async function persistProjectConversation(
  developerPath: string,
  projectName: string | undefined,
  chatThreadId: string | undefined,
  messages: Message[],
  assistantText: string,
) {
  if (!projectName || !chatThreadId) return

  const previousThread = await readChatThread(developerPath, projectName, chatThreadId)
  const storedMessages = [
    ...messages.map((message, index) => ({
      id: `chat-${index}-${message.role}`,
      role: message.role,
      content: message.content,
      source: "chat" as const,
    })),
    {
      id: `assistant-${Date.now()}`,
      role: "assistant" as const,
      content: assistantText,
      source: "chat" as const,
    },
  ]

  await saveChatThread(developerPath, projectName, chatThreadId, storedMessages)

  const previousLastId = previousThread?.messages.at(-1)?.id ?? null
  const nextLastId = storedMessages.at(-1)?.id ?? null
  if (nextLastId && nextLastId !== previousLastId) {
    await recordThreadMessageCreated({
      projectName,
      chatThreadId,
      messageCount: storedMessages.length,
      body: "Project chat saved a new assistant reply.",
    }).catch(() => null)
  }
}

function latestThreadJobs(jobs: Awaited<ReturnType<typeof listJobs>>, chatThreadId?: string) {
  return jobs.filter((job) => (chatThreadId ? job.chatThreadId === chatThreadId : true))
}

function buildUnsupportedProjectChatReply(projectName: string, projectStatus: Awaited<ReturnType<typeof getProjectStatus>>, runnerAvailable: boolean) {
  return [
    `${projectName} chat is running in deterministic local-only mode right now.`,
    projectStatus.ceoDecision
      ? `Current decision: ${projectStatus.ceoDecision.title}.`
      : projectStatus.investigation
        ? `Current blocker: ${projectStatus.investigation.summary}`
        : `Current runtime: ${projectStatus.runtimeState?.status ?? "unknown"}.`,
    runnerAvailable
      ? "Supported asks: status, what does this project need right now, what is the decision, why is it queued, and proceed."
      : "Supported asks: status, what does this project need right now, what is the decision, and why is it queued. Launches are blocked until the local Inngest runner is back up.",
  ].join("\n")
}

async function handleProjectChat(params: {
  developerPath: string
  projectName: string
  chatThreadId?: string
  messages: Message[]
  latestUserMessage: string
}) {
  const { developerPath, projectName, chatThreadId, messages, latestUserMessage } = params
  const [projectStatus, allJobs, runnerAvailable] = await Promise.all([
    getProjectStatus(projectName),
    listJobs(developerPath, projectName),
    isLocalWorkerRunnerAvailable(),
  ])
  const liveJobs = latestThreadJobs(allJobs, chatThreadId)
  const selectedDecision = detectDecisionSelection(latestUserMessage, projectName)

  let text: string

  if (selectedDecision) {
    const result = await applyProjectDecision(projectName, selectedDecision)
    text = `${projectName} decision recorded.\nDecision: ${selectedDecision}\nNext: ${result.summary}`
    await persistProjectConversation(developerPath, projectName, chatThreadId, messages, text)
    return textResponse(text)
  }

  if (isLikelyDecisionExplanationRequest(latestUserMessage)) {
    text = buildProjectDecisionExplanationReply(projectName, projectStatus)
    await persistProjectConversation(developerPath, projectName, chatThreadId, messages, text)
    return textResponse(text)
  }

  if (isLikelyDecisionRequest(latestUserMessage)) {
    text = buildProjectDecisionReply(projectName, projectStatus)
    await persistProjectConversation(developerPath, projectName, chatThreadId, messages, text)
    return textResponse(text)
  }

  if (isLikelyStatusRequest(latestUserMessage) || isLikelyQueueBlockerRequest(latestUserMessage)) {
    text = buildProjectStatusReplyWithRunner(projectName, liveJobs, projectStatus, runnerAvailable)
    await persistProjectConversation(developerPath, projectName, chatThreadId, messages, text)
    return textResponse(text)
  }

  if (isLikelyProjectNeedsRequest(latestUserMessage)) {
    text = buildProjectNeedsReply(projectName, projectStatus)
    await persistProjectConversation(developerPath, projectName, chatThreadId, messages, text)
    return textResponse(text)
  }

  if (projectStatus.runtimeState?.status === "blocked_on_config") {
    text = blockedOnConfigMessage(projectName, projectStatus)
    await persistProjectConversation(developerPath, projectName, chatThreadId, messages, text)
    return textResponse(text)
  }

  const implicitLaunch = getImplicitProjectLaunch(latestUserMessage, {
    investigation: projectStatus.investigation,
    recommendedAction: projectStatus.recommendedAction,
  })
  if (implicitLaunch) {
    if (!runnerAvailable) {
      text = buildWorkerRunnerUnavailableReply(projectName, liveJobs[0] ?? null)
      await persistProjectConversation(developerPath, projectName, chatThreadId, messages, text)
      return textResponse(text)
    }

    const spec = buildProjectRunSpec(projectName, implicitLaunch.template, implicitLaunch.instruction)
    const job = await launchJob({
      developerPath,
      type: "project_task",
      projectName,
      chatThreadId: chatThreadId ?? null,
      runTemplate: spec.template,
      instruction: spec.instruction,
      successCriteria: spec.successCriteria,
      governanceTargets: spec.governanceTargets,
    })

    const pathLabel = implicitLaunch.source === "investigation" ? "the active investigation path" : "the locally recommended next action"
    text = `Approved. I launched ${spec.label.toLowerCase()} for ${projectName} using ${pathLabel}.\n\nJob: ${job.id}\nNext: I’ll keep status in this thread and the work view.`
    await persistProjectConversation(developerPath, projectName, chatThreadId, messages, text)
    return textResponse(text)
  }

  text = buildUnsupportedProjectChatReply(projectName, projectStatus, runnerAvailable)
  await persistProjectConversation(developerPath, projectName, chatThreadId, messages, text)
  return textResponse(text)
}

export async function POST(request: Request) {
  const developerPath = process.env.DEVELOPER_PATH
  if (!developerPath) {
    return textResponse("DEVELOPER_PATH is not configured.", 500)
  }

  const { messages, projectName, chatThreadId } = (await request.json()) as {
    messages: Message[]
    projectName?: string
    chatThreadId?: string
  }
  const latestUserMessage = messages.filter((message) => message.role === "user").at(-1)?.content ?? ""

  if (!projectName) {
    return textResponse(
      "Portfolio chat is disabled during stabilization. Use a project chat or project work view until the deterministic core is solid again.",
    )
  }

  return handleProjectChat({
    developerPath,
    projectName,
    chatThreadId,
    messages,
    latestUserMessage,
  })
}
