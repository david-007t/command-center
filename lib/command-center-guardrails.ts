export type UsageBudgetStatus = "healthy" | "watch" | "critical"

export type UsageGuardrailSummary = {
  weeklyTokensStatus: UsageBudgetStatus
  weeklyCostStatus: UsageBudgetStatus
  monthlyCostStatus: UsageBudgetStatus
  overallStatus: UsageBudgetStatus
  headline: string
  recommendedAction: string
}

export type InvestigationAutonomyMode = "can_autofix" | "needs_review" | "needs_ceo_approval"

export type InvestigationAutonomy = {
  mode: InvestigationAutonomyMode
  rationale: string
}

const WEEKLY_TOKEN_WATCH = 250_000
const WEEKLY_TOKEN_CRITICAL = 500_000
const WEEKLY_COST_WATCH = 10
const WEEKLY_COST_CRITICAL = 25
const MONTHLY_COST_WATCH = 40
const MONTHLY_COST_CRITICAL = 100

function classifyBudget(value: number, watchThreshold: number, criticalThreshold: number): UsageBudgetStatus {
  if (value >= criticalThreshold) return "critical"
  if (value >= watchThreshold) return "watch"
  return "healthy"
}

function maxStatus(left: UsageBudgetStatus, right: UsageBudgetStatus): UsageBudgetStatus {
  const rank = { healthy: 0, watch: 1, critical: 2 } as const
  return rank[left] >= rank[right] ? left : right
}

export function deriveUsageGuardrails(input: {
  weeklyTokens: number
  weeklyCostUsd: number
  monthlyCostUsd: number
}): UsageGuardrailSummary {
  const weeklyTokensStatus = classifyBudget(input.weeklyTokens, WEEKLY_TOKEN_WATCH, WEEKLY_TOKEN_CRITICAL)
  const weeklyCostStatus = classifyBudget(input.weeklyCostUsd, WEEKLY_COST_WATCH, WEEKLY_COST_CRITICAL)
  const monthlyCostStatus = classifyBudget(input.monthlyCostUsd, MONTHLY_COST_WATCH, MONTHLY_COST_CRITICAL)
  const overallStatus = [weeklyTokensStatus, weeklyCostStatus, monthlyCostStatus].reduce(maxStatus, "healthy" as UsageBudgetStatus)

  if (overallStatus === "critical") {
    return {
      weeklyTokensStatus,
      weeklyCostStatus,
      monthlyCostStatus,
      overallStatus,
      headline: "Usage pressure is high enough that new long runs should be deliberate.",
      recommendedAction: "Prefer narrow follow-up runs, refresh context packs before large chats, and pause broad investigations unless they are urgent.",
    }
  }

  if (overallStatus === "watch") {
    return {
      weeklyTokensStatus,
      weeklyCostStatus,
      monthlyCostStatus,
      overallStatus,
      headline: "Usage is climbing, so the system should favor compact context and scoped runs.",
      recommendedAction: "Use project chat, keep investigations narrow, and refresh compacted memory before launching heavier work.",
    }
  }

  return {
    weeklyTokensStatus,
    weeklyCostStatus,
    monthlyCostStatus,
    overallStatus,
    headline: "Usage is within a comfortable range for normal project work.",
    recommendedAction: "Normal project chat and investigation behavior is safe.",
  }
}

export function deriveInvestigationAutonomy(input: {
  canAutofix: boolean
  contextHealth?: "healthy" | "watch" | "overloaded" | null
  usageStatus?: UsageBudgetStatus | null
}): InvestigationAutonomy {
  if (!input.canAutofix) {
    return {
      mode: "needs_ceo_approval",
      rationale: "The current investigation is not marked safe for automatic remediation, so the system should pause for explicit review before making external changes.",
    }
  }

  if (input.contextHealth === "overloaded" || input.usageStatus === "critical") {
    return {
      mode: "needs_review",
      rationale: "The system can still investigate, but context pressure or usage pressure is high enough that it should stay narrow and avoid broad autonomous changes.",
    }
  }

  if (input.contextHealth === "watch" || input.usageStatus === "watch") {
    return {
      mode: "needs_review",
      rationale: "The next run is probably safe, but the system should keep the fix narrow and be ready to escalate if the first verification is not conclusive.",
    }
  }

  return {
    mode: "can_autofix",
    rationale: "The current investigation is low-risk enough for the system to attempt the narrowest safe remediation before escalating.",
  }
}

export function deriveCompactionHealth(approximateTokens: number) {
  if (approximateTokens > 2400) {
    return {
      health: "overloaded" as const,
      recommendedAction: "Compact recent history before relying on this pack for another long interaction.",
    }
  }

  if (approximateTokens > 1800) {
    return {
      health: "watch" as const,
      recommendedAction: "Keep the next chat or run narrow and refresh the compacted pack soon.",
    }
  }

  return {
    health: "healthy" as const,
    recommendedAction: "The compacted pack is small enough for normal project chat and worker launches.",
  }
}
