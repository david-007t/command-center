type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out" | "awaiting_ceo" | "blocked" | "blocked_on_config"
type RuntimeJobStage = "queued" | "reading_context" | "planning" | "executing" | "verifying" | "updating_governance" | "done" | "blocked"

type ChatRunJob = {
  id: string
  projectName: string | null
  chatThreadId?: string | null
  status: JobStatus
  createdAt: string
  completedAt: string | null
  summary: string
  currentStage: RuntimeJobStage
  stageUpdatedAt: string
}

export type ChatRunEvent = {
  jobId: string
  chatThreadId: string | null
  projectName: string | null
  kind: "live" | "final"
  title: string
  body: string
  createdAt: string
  updatedAt: string
  status: JobStatus
}

const STAGE_LABELS: Record<RuntimeJobStage, string> = {
  queued: "Queued",
  reading_context: "Reading context",
  planning: "Planning",
  executing: "Executing",
  verifying: "Verifying",
  updating_governance: "Updating governance",
  done: "Done",
  blocked: "Blocked",
}

const SECTION_ALIASES: Record<string, string> = {
  "current step": "What I'm doing now",
  findings: "What I found",
  verification: "Verified vs inferred",
  "next move": "What I'm doing next",
  "what it is checking": "What I checked",
}

function cleaned(text: string) {
  return text.trim()
}

function normalizeHeading(heading: string) {
  const normalized = heading.trim().toLowerCase()
  return SECTION_ALIASES[normalized] ?? heading.trim()
}

function formatStructuredBody(text: string) {
  const raw = cleaned(text)
  if (!raw) return raw

  const lines = raw.split("\n")
  const formatted: string[] = []

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/)
    if (!match) {
      formatted.push(line)
      continue
    }

    formatted.push(`**${normalizeHeading(match[1])}**`)
  }

  return formatted.join("\n")
}

export function buildChatRunEvent(job: ChatRunJob, commentaryPreview: string, messagePreview: string): ChatRunEvent {
  const isFinal =
    job.status === "completed" ||
    job.status === "awaiting_ceo" ||
    job.status === "blocked" ||
    job.status === "blocked_on_config" ||
    job.status === "failed" ||
    job.status === "timed_out" ||
    job.status === "cancelled"
  const finalBody = formatStructuredBody(messagePreview || (isFinal ? job.summary : commentaryPreview) || commentaryPreview || job.summary)

  if (isFinal) {
    return {
      jobId: job.id,
      chatThreadId: job.chatThreadId ?? null,
      projectName: job.projectName,
      kind: "final",
      title:
        job.status === "completed" || job.status === "awaiting_ceo"
          ? "Verified outcome"
          : job.status === "blocked"
            ? "Blocked outcome"
            : "Run outcome",
      body: finalBody,
      createdAt: job.createdAt,
      updatedAt: job.completedAt ?? job.stageUpdatedAt,
      status: job.status,
    }
  }

  return {
    jobId: job.id,
    chatThreadId: job.chatThreadId ?? null,
    projectName: job.projectName,
    kind: "live",
    title: `${STAGE_LABELS[job.currentStage]} in progress`,
    body: formatStructuredBody(commentaryPreview || job.summary || "Run launched from this chat thread."),
    createdAt: job.createdAt,
    updatedAt: job.stageUpdatedAt,
    status: job.status,
  }
}
