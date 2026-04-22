type WorkOrderRun = {
  id: string
  status: string
  summary?: string | null
  currentStage?: string | null
  messagePreview?: string | null
  logPreview?: string | null
}

export type WorkOrderExecutionState = {
  frozen: boolean
  canContinue: boolean
  complete: boolean
  label: string
  reason: string
  continuationPoint: string
}

const activeStatuses = new Set(["queued", "running"])
const resumableStatuses = new Set(["blocked", "failed", "timed_out"])
const completeStatuses = new Set(["completed", "awaiting_ceo"])

function shortText(value?: string | null) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  return normalized.length > 260 ? `${normalized.slice(0, 257)}...` : normalized
}

export function describeWorkOrderExecutionState(params: {
  planStatus: "draft" | "ready" | "approved" | "sent_back"
  currentRun?: WorkOrderRun | null
  latestFinishedRun?: WorkOrderRun | null
}): WorkOrderExecutionState {
  const { planStatus, currentRun, latestFinishedRun } = params

  if (currentRun && activeStatuses.has(currentRun.status)) {
    return {
      frozen: true,
      canContinue: false,
      complete: false,
      label: "Plan locked while worker runs",
      reason: "This approved plan is frozen until the active worker reaches a final state.",
      continuationPoint: shortText(currentRun.summary) || "Worker is still running this plan.",
    }
  }

  if (planStatus === "approved" && latestFinishedRun && resumableStatuses.has(latestFinishedRun.status)) {
    return {
      frozen: true,
      canContinue: true,
      complete: false,
      label: "Plan paused before completion",
      reason: "The plan stays frozen because the latest worker attempt stopped before the approved work was done.",
      continuationPoint:
        shortText(latestFinishedRun.messagePreview) ||
        shortText(latestFinishedRun.logPreview) ||
        shortText(latestFinishedRun.summary) ||
        "Continue from the latest blocked worker attempt.",
    }
  }

  if (planStatus === "approved" && latestFinishedRun && completeStatuses.has(latestFinishedRun.status)) {
    return {
      frozen: false,
      canContinue: false,
      complete: true,
      label: "Plan completed",
      reason: "The approved plan has reached a completed state. You can test the result or start a new plan.",
      continuationPoint: shortText(latestFinishedRun.summary) || "No continuation needed.",
    }
  }

  return {
    frozen: false,
    canContinue: false,
    complete: false,
    label: planStatus === "ready" ? "Plan ready for approval" : "Plan editable",
    reason: planStatus === "ready" ? "Review the plan, then approve it to launch work." : "No approved plan is currently locked.",
    continuationPoint: "Create or approve a plan to start execution.",
  }
}
