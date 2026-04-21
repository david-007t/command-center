import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { deriveUsageGuardrails } from "@/lib/command-center-guardrails"

export type UsageSource = "anthropic_actual" | "codex_estimated"

export type UsageRecord = {
  id: string
  createdAt: string
  source: UsageSource
  scope: "portfolio_chat" | "project_chat" | "project_run" | "system_run"
  projectName: string | null
  model: string
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  pricingLabel: string
  jobId: string | null
  notes: string | null
}

const PRICING = {
  "claude-sonnet-4-20250514": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    label: "Anthropic Claude Sonnet 4 standard pricing",
  },
  codex_estimated: {
    inputPerMillion: 0,
    outputPerMillion: 0,
    label: "Estimated tokens only; Codex local cost is not directly available here",
  },
} as const

function usageDir(developerPath: string) {
  return path.join(developerPath, "_system", "runtime", "usage")
}

async function ensureUsageDir(developerPath: string) {
  const dir = usageDir(developerPath)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number) {
  const pricing = PRICING[model as keyof typeof PRICING]
  if (!pricing) return 0
  return (inputTokens / 1_000_000) * pricing.inputPerMillion + (outputTokens / 1_000_000) * pricing.outputPerMillion
}

export function estimateTokensFromText(text: string) {
  if (!text.trim()) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

export async function recordUsage(
  developerPath: string,
  input: Omit<UsageRecord, "id" | "createdAt" | "estimatedCostUsd" | "pricingLabel">,
) {
  const dir = await ensureUsageDir(developerPath)
  const id = randomUUID()
  const createdAt = new Date().toISOString()
  const pricing = PRICING[input.model as keyof typeof PRICING] ?? PRICING.codex_estimated
  const record: UsageRecord = {
    id,
    createdAt,
    estimatedCostUsd: estimateCostUsd(input.model, input.inputTokens, input.outputTokens),
    pricingLabel: pricing.label,
    ...input,
  }

  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(record, null, 2) + "\n", "utf8")
  return record
}

export async function listUsageRecords(developerPath: string, limit = 200) {
  const dir = await ensureUsageDir(developerPath)
  const entries = await fs.readdir(dir).catch(() => [])
  const records = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        const raw = await fs.readFile(path.join(dir, entry), "utf8").catch(() => "")
        return raw ? (JSON.parse(raw) as UsageRecord) : null
      }),
  )

  return records
    .filter((record): record is UsageRecord => Boolean(record))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit)
}

function sameWeek(date: Date, now: Date) {
  const start = new Date(now)
  const day = start.getDay()
  const diffToMonday = (day + 6) % 7
  start.setDate(start.getDate() - diffToMonday)
  start.setHours(0, 0, 0, 0)
  return date >= start
}

export async function summarizeUsage(developerPath: string) {
  const records = await listUsageRecords(developerPath, 500)
  const now = new Date()

  const monthly = records.filter((record) => {
    const date = new Date(record.createdAt)
    return date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth()
  })
  const weekly = records.filter((record) => sameWeek(new Date(record.createdAt), now))
  const byProject = records.reduce<Record<string, { tokens: number; cost: number }>>((acc, record) => {
    if (!record.projectName) return acc
    const current = acc[record.projectName] ?? { tokens: 0, cost: 0 }
    current.tokens += record.inputTokens + record.outputTokens
    current.cost += record.estimatedCostUsd
    acc[record.projectName] = current
    return acc
  }, {})

  const totalTokens = (items: UsageRecord[]) => items.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0)
  const totalCost = (items: UsageRecord[]) => items.reduce((sum, item) => sum + item.estimatedCostUsd, 0)
  const actualMonthly = monthly.filter((item) => item.source === "anthropic_actual")
  const estimatedMonthly = monthly.filter((item) => item.source === "codex_estimated")

  return {
    monthly: {
      totalTokens: totalTokens(monthly),
      estimatedCostUsd: totalCost(monthly),
      actualCostUsd: totalCost(actualMonthly),
      estimatedCodexCostUsd: totalCost(estimatedMonthly),
    },
    weekly: {
      totalTokens: totalTokens(weekly),
      estimatedCostUsd: totalCost(weekly),
    },
    codexDesktop: {
      weeklyLimitStatus: "Unavailable from local Codex runtime",
      currentUsageStatus: "Direct Codex quota/limit telemetry is not exposed here yet",
    },
    guardrails: deriveUsageGuardrails({
      weeklyTokens: totalTokens(weekly),
      weeklyCostUsd: totalCost(weekly),
      monthlyCostUsd: totalCost(monthly),
    }),
    byProject,
    recent: records.slice(0, 12),
  }
}
