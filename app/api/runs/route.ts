import path from "path"
import { NextResponse } from "next/server"
import { buildChatRunEvent } from "@/lib/chat-run-thread"
import {
  buildProjectRunSpec,
  cancelJob,
  getDeveloperPath,
  launchJob,
  listJobs,
  readCommentaryPreview,
  readLogPreview,
  readMessagePreview,
  readProjectRuntimeState,
  recommendRunTemplateForProject,
  retryJob,
  type JobType,
} from "@/lib/orchestration"

export const dynamic = "force-dynamic"

async function normalizeJobPayload(job: Awaited<ReturnType<typeof listJobs>>[number], messagePreview: string) {
  return {
    ...job,
    messagePreview,
    commentaryPreview: await readCommentaryPreview(job.commentaryPath),
    logPreview: await readLogPreview(job.logPath),
    logFileName: path.basename(job.logPath),
  }
}

export async function GET(request: Request) {
  const developerPath = getDeveloperPath()
  const url = new URL(request.url)
  const projectName = url.searchParams.get("project") ?? undefined
  const chatThreadId = url.searchParams.get("chatThreadId")
  const jobs = (await listJobs(developerPath, projectName)).filter((job) => (chatThreadId ? job.chatThreadId === chatThreadId : true))
  const payload = await Promise.all(
    jobs.map(async (job) => normalizeJobPayload(job, await readMessagePreview(job.messagePath))),
  )

  return NextResponse.json({
    jobs: payload,
    events: payload.map((job) => buildChatRunEvent(job, job.commentaryPreview, job.messagePreview)),
  })
}

export async function POST(request: Request) {
  const developerPath = getDeveloperPath()
  const body = (await request.json()) as {
    type: JobType
    projectName?: string
    chatThreadId?: string
    instruction: string
    runTemplate?: "custom" | "continue_project" | "fix_blocker" | "fix_issue" | "review_next_move" | "prep_qa" | "investigate_issue"
  }

  const type = body.type
  if (!type || !body.instruction?.trim()) {
    return NextResponse.json({ error: "type and instruction are required." }, { status: 400 })
  }

  if (type === "project_task" && !body.projectName) {
    return NextResponse.json({ error: "projectName is required for project tasks." }, { status: 400 })
  }

  const projectName = body.projectName ?? null
  try {
    const spec =
      type === "project_task" && projectName
        ? buildProjectRunSpec(
            projectName,
            body.runTemplate ??
              (await recommendRunTemplateForProject({
                developerPath,
                projectName,
                instruction: body.instruction.trim(),
                runtimeState: await readProjectRuntimeState(developerPath, projectName),
              })),
            body.instruction.trim(),
          )
        : null

    const job = await launchJob({
      developerPath,
      type,
      projectName,
      chatThreadId: body.chatThreadId ?? null,
      runTemplate: spec?.template ?? null,
      instruction: spec?.instruction ?? body.instruction.trim(),
      successCriteria: spec?.successCriteria ?? [],
      governanceTargets: spec?.governanceTargets ?? [],
    })

    return NextResponse.json({
      job: {
        ...job,
        messagePreview: "",
        commentaryPreview: "",
        logFileName: path.basename(job.logPath),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to launch worker."
    const status = /already active/i.test(message) ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function PATCH(request: Request) {
  const developerPath = getDeveloperPath()
  const body = (await request.json()) as {
    action: "cancel" | "retry"
    jobId: string
  }

  if (!body.jobId || !body.action) {
    return NextResponse.json({ error: "jobId and action are required." }, { status: 400 })
  }

  try {
    const job =
      body.action === "cancel"
        ? await cancelJob(developerPath, body.jobId)
        : await retryJob(developerPath, body.jobId)

    return NextResponse.json({
      job: {
        ...job,
        messagePreview: "",
        commentaryPreview: "",
        logFileName: path.basename(job.logPath),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update worker."
    const status = /active|cancelled|queued|running/i.test(message) ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
