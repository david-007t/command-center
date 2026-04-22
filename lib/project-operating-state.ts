export type ProjectOperatingStateStatus =
  | "worker_running"
  | "blocked"
  | "pending_ceo_test"
  | "needs_record_refresh"
  | "ready"
  | "building"

export type ProjectOperatingState = {
  status: ProjectOperatingStateStatus
  label: string
  summary: string
  nextAction: string
  blocker: string
  tone: "green" | "purple" | "amber" | "red" | "neutral"
}

type DeriveProjectOperatingStateInput = {
  phase: string
  runtimeStatus?: string | null
  qaChecklist?: string
  securityChecklist?: string
  latestActiveRunStatus?: string | null
  latestFinishedRunStatus?: string | null
  latestFinishedRunSummary?: string | null
}

function qaNeedsProductFlow(markdown?: string) {
  if (!markdown) return false
  const normalized = markdown.toLowerCase()
  return (
    /result:\s*fail/.test(normalized) &&
    (/runtime qa evidence|happy-path|happy path|product flow|product-flow|375px|browser qa/.test(normalized))
  )
}

function isBlockedStatus(status?: string | null) {
  return status === "blocked" || status === "blocked_on_config" || status === "failed" || status === "timed_out"
}

export function deriveProjectOperatingState(input: DeriveProjectOperatingStateInput): ProjectOperatingState {
  if (input.latestActiveRunStatus === "running" || input.latestActiveRunStatus === "queued") {
    return {
      status: "worker_running",
      label: "Worker running",
      summary: "The worker is still executing. Wait for completion before product testing.",
      nextAction: "Watch the Work tab until the run finishes or asks for help.",
      blocker: "Testing should wait until the active worker is done.",
      tone: "purple",
    }
  }

  if (isBlockedStatus(input.runtimeStatus) || isBlockedStatus(input.latestFinishedRunStatus)) {
    return {
      status: "blocked",
      label: "Blocked",
      summary: "The project is blocked before CEO testing.",
      nextAction: "Resolve the blocker shown in the latest run before testing the product flow.",
      blocker: input.latestFinishedRunSummary || "The latest run did not finish cleanly.",
      tone: "red",
    }
  }

  if (qaNeedsProductFlow(input.qaChecklist)) {
    return {
      status: "pending_ceo_test",
      label: "Pending CEO test",
      summary: "The worker finished real work and the product is ready for you to test, but QA is not signed off yet.",
      nextAction: "Open the product and run the normal lead-generation flow. Save, edit, delete, and refresh a Ship List company.",
      blocker: "Waiting on CEO product-flow test evidence.",
      tone: "purple",
    }
  }

  if (input.runtimeStatus === "stale_governance") {
    return {
      status: "needs_record_refresh",
      label: "Needs record refresh",
      summary: "The latest work and the project record are not fully aligned yet.",
      nextAction: "Refresh the project record before relying on this status.",
      blocker: "Project governance is stale.",
      tone: "amber",
    }
  }

  if (input.phase.toLowerCase().includes("build")) {
    return {
      status: "building",
      label: "In build",
      summary: "The project is still in active build mode.",
      nextAction: "Continue the next build task or move it to testing when QA gates are ready.",
      blocker: "No CEO test blocker is currently detected.",
      tone: "amber",
    }
  }

  return {
    status: "ready",
    label: "Ready",
    summary: "No active blocker is detected.",
    nextAction: "Review the latest run and decide the next move.",
    blocker: "None detected.",
    tone: "green",
  }
}
