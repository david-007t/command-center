import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"

export type FeedbackScope = "system" | "project"
export type FeedbackCategory = "self_heal" | "product_improvement" | "governance_fix" | "needs_decision"
export type FeedbackStatus = "logged" | "actioning" | "resolved" | "needs_decision"
export type FeedbackSeverity = "low" | "medium" | "high"

export type FeedbackRecord = {
  id: string
  createdAt: string
  scope: FeedbackScope
  projectName: string | null
  category: FeedbackCategory
  severity: FeedbackSeverity
  summary: string
  desiredOutcome: string
  status: FeedbackStatus
  source: "chat"
  relatedJobId: string | null
  resolutionNote: string | null
}

function feedbackDir(developerPath: string) {
  return path.join(developerPath, "_system", "runtime", "feedback")
}

async function ensureFeedbackDir(developerPath: string) {
  const dir = feedbackDir(developerPath)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function jobFilePath(developerPath: string, jobId: string) {
  return path.join(developerPath, "_system", "runtime", "jobs", `${jobId}.json`)
}

export async function createFeedbackRecord(
  developerPath: string,
  record: Omit<FeedbackRecord, "id" | "createdAt"> & { id?: string; createdAt?: string },
) {
  const dir = await ensureFeedbackDir(developerPath)
  const id = record.id ?? randomUUID()
  const createdAt = record.createdAt ?? new Date().toISOString()
  const next: FeedbackRecord = {
    id,
    createdAt,
    ...record,
  }

  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(next, null, 2) + "\n", "utf8")
  return next
}

export async function updateFeedbackRecord(
  developerPath: string,
  id: string,
  updates: Partial<Omit<FeedbackRecord, "id" | "createdAt">>,
) {
  const dir = await ensureFeedbackDir(developerPath)
  const filePath = path.join(dir, `${id}.json`)
  const current = JSON.parse(await fs.readFile(filePath, "utf8")) as FeedbackRecord
  const next = { ...current, ...updates }
  await fs.writeFile(filePath, JSON.stringify(next, null, 2) + "\n", "utf8")
  return next
}

export async function listFeedbackRecords(developerPath: string, limit = 12) {
  const dir = await ensureFeedbackDir(developerPath)
  const entries = await fs.readdir(dir).catch(() => [])
  const records = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const raw = await fs.readFile(path.join(dir, entry), "utf8").catch(() => "")
        return raw ? (JSON.parse(raw) as FeedbackRecord) : null
      }),
  )

  const reconciled = await Promise.all(
    records.filter(Boolean).map(async (record) => {
      if (!record?.relatedJobId || record.status !== "actioning") {
        return record
      }

      const rawJob = await fs.readFile(jobFilePath(developerPath, record.relatedJobId), "utf8").catch(() => "")
      if (!rawJob) return record
      const job = JSON.parse(rawJob) as { status: string; summary: string }

      if (job.status === "completed") {
        return {
          ...record,
          status: "resolved",
          resolutionNote: job.summary,
        } satisfies FeedbackRecord
      }

      if (job.status === "awaiting_ceo" || job.status === "blocked" || job.status === "failed" || job.status === "timed_out") {
        return {
          ...record,
          status: "needs_decision",
          resolutionNote: job.summary,
        } satisfies FeedbackRecord
      }

      return record
    }),
  )

  return reconciled
    .filter((record): record is FeedbackRecord => Boolean(record))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit)
}
