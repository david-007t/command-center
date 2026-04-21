import type { ProjectRuntimeState, RuntimeJob } from "./orchestration"

function hasRequiredOutcomeSummary(messagePreview: string) {
  const text = (messagePreview || "").trim()
  if (!text) return false
  return /\bOutcome\b/i.test(text) && /\bVerification\b/i.test(text)
}

function shouldTreatUsageLimitAsBlocking(params: {
  finalStatus: RuntimeJob["status"]
  messagePreview: string
  lowerLog: string
}) {
  if (!/usage limit|purchase more credits|upgrade to pro/.test(params.lowerLog)) return false
  if (params.finalStatus === "failed" || params.finalStatus === "timed_out") return true
  return !hasRequiredOutcomeSummary(params.messagePreview)
}

function shouldTreatRuntimeAuthAsBlocking(params: {
  finalStatus: RuntimeJob["status"]
  messagePreview: string
  lowerLog: string
}) {
  if (!/401 unauthorized|missing bearer or basic authentication/.test(params.lowerLog)) return false
  if (params.finalStatus === "failed" || params.finalStatus === "timed_out") return true
  return !hasRequiredOutcomeSummary(params.messagePreview)
}

function shouldTreatMessageAsBlocked(params: {
  finalStatus: RuntimeJob["status"]
  messagePreview: string
  lowerPreview: string
}) {
  if (params.finalStatus === "failed" || params.finalStatus === "timed_out") return true
  if (!hasRequiredOutcomeSummary(params.messagePreview)) return true
  return /\b(unable to proceed|cannot proceed|need access|waiting on)\b/.test(params.lowerPreview)
}

export function deriveConfigBlocker(messagePreview: string) {
  if (/missing credential|missing token|configure_vercel_token/i.test(messagePreview || "")) {
    return {
      credential: "Required credential not configured",
      detail: "The worker reported a missing credential and cannot continue safely.",
      nextStep: "Add the missing credential in Supabase Vault or the runtime environment, then re-run the worker.",
    }
  }

  return null
}

export function classifyWorkerOutcome(params: {
  finalJob: Pick<RuntimeJob, "type" | "status" | "runTemplate" | "initialGitHead">
  messagePreview: string
  headAfter: string
  changedFiles?: string[]
  logPreview?: string
}) {
  const lowerPreview = (params.messagePreview || "").toLowerCase()
  const lowerLog = (params.logPreview || "").toLowerCase()
  const completedLabel =
    params.finalJob.type === "system_task"
      ? "Codex worker completed the requested system improvement."
      : "Codex worker completed the requested project task."
  const configBlocker = deriveConfigBlocker(params.messagePreview)

  if (configBlocker) {
    return {
      jobStatus: "blocked_on_config" as const,
      summary: `Worker is blocked on configuration: ${configBlocker.credential}.`,
      configBlocker,
    }
  }

  if (
    shouldTreatUsageLimitAsBlocking({
      finalStatus: params.finalJob.status,
      messagePreview: params.messagePreview,
      lowerLog,
    })
  ) {
    return {
      jobStatus: "blocked" as const,
      summary:
        "Codex worker is blocked by the current Codex usage limit. Restore available credits or wait for the limit reset before retrying this fix.",
      configBlocker: null,
    }
  }

  if (
    shouldTreatRuntimeAuthAsBlocking({
      finalStatus: params.finalJob.status,
      messagePreview: params.messagePreview,
      lowerLog,
    })
  ) {
    return {
      jobStatus: "blocked" as const,
      summary: "Codex worker is blocked because the runtime authentication is not valid for model execution.",
      configBlocker: null,
    }
  }

  if (params.finalJob.status === "failed" || params.finalJob.status === "timed_out") {
    return {
      jobStatus: "blocked" as const,
      summary: "Codex worker ended in a blocked state. Check the log and governance files for details.",
      configBlocker: null,
    }
  }

  if (params.finalJob.status === "cancelled") {
    return {
      jobStatus: "cancelled" as const,
      summary: "Worker was cancelled before completion.",
      configBlocker: null,
    }
  }

  if (/ceo|escalat|approve|decision needed/.test(lowerPreview)) {
    return {
      jobStatus: "awaiting_ceo" as const,
      summary: "Codex worker completed and surfaced a CEO decision.",
      configBlocker: null,
    }
  }

  if (
    shouldTreatMessageAsBlocked({
      finalStatus: params.finalJob.status,
      messagePreview: params.messagePreview,
      lowerPreview,
    })
  ) {
    return {
      jobStatus: "blocked" as const,
      summary: "Codex worker completed its investigation but remains blocked on the next step.",
      configBlocker: null,
    }
  }

  if (!hasRequiredOutcomeSummary(params.messagePreview)) {
    return {
      jobStatus: "blocked" as const,
      summary: "Worker finished without the required outcome summary and verification sections.",
      configBlocker: null,
    }
  }

  if (
    params.finalJob.runTemplate === "fix_issue" &&
    (!params.headAfter || params.headAfter === (params.finalJob.initialGitHead || ""))
  ) {
    return {
      jobStatus: "blocked" as const,
      summary: "Fix run finished without a new git commit, so the fix cannot be trusted as complete.",
      configBlocker: null,
    }
  }

  if (params.finalJob.runTemplate === "fix_issue" && (!params.changedFiles?.length || params.changedFiles.length === 0)) {
    return {
      jobStatus: "blocked" as const,
      summary: "Fix run finished without any file changes, so it cannot be trusted as a real fix.",
      configBlocker: null,
    }
  }

  return {
    jobStatus: "completed" as const,
    summary: completedLabel,
    configBlocker: null,
  }
}

export function buildRuntimeStateFromFinalJob(params: {
  job: RuntimeJob
  governanceUpdated: boolean
  updatedTargets: string[]
  missingTargets: string[]
  messagePreview: string
  summary: string
}) {
  const lowerPreview = params.messagePreview.toLowerCase()
  let status: ProjectRuntimeState["status"] = "healthy"

  if (params.job.status === "failed" || params.job.status === "timed_out") status = "blocked"
  if (params.job.status === "blocked") status = "blocked"
  if (params.job.status === "cancelled") status = "cancelled"
  if (params.job.status === "blocked_on_config") status = "blocked_on_config"
  if (/ceo|escalat|approve|decision needed/.test(lowerPreview)) status = "awaiting_ceo"
  if (params.job.status === "completed" && params.missingTargets.length > 0) status = "stale_governance"

  return {
    projectName: params.job.projectName!,
    jobId: params.job.id,
    runTemplate: params.job.runTemplate,
    status,
    summary: params.summary,
    configBlocker: params.job.configBlocker ?? null,
    governanceUpdated: params.governanceUpdated,
    governanceTargets: params.job.governanceTargets,
    updatedTargets: params.updatedTargets,
    missingTargets: params.missingTargets,
    completedAt: params.job.completedAt,
    messagePreview: params.messagePreview,
    currentStage: params.job.currentStage,
    stageUpdatedAt: params.job.stageUpdatedAt,
  }
}
