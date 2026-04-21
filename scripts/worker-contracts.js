function hasRequiredOutcomeSummary(messagePreview) {
  const text = (messagePreview || "").trim()
  if (!text) return false
  return /\bOutcome\b/i.test(text) && /\bVerification\b/i.test(text)
}

function shouldTreatUsageLimitAsBlocking(finalStatus, messagePreview, lowerLog) {
  if (!/usage limit|purchase more credits|upgrade to pro/.test(lowerLog)) return false
  if (finalStatus === "failed" || finalStatus === "timed_out") return true
  return !hasRequiredOutcomeSummary(messagePreview)
}

function shouldTreatRuntimeAuthAsBlocking(finalStatus, messagePreview, lowerLog) {
  if (!/401 unauthorized|missing bearer or basic authentication/.test(lowerLog)) return false
  if (finalStatus === "failed" || finalStatus === "timed_out") return true
  return !hasRequiredOutcomeSummary(messagePreview)
}

function shouldTreatMessageAsBlocked(finalStatus, messagePreview, lowerPreview) {
  if (finalStatus === "failed" || finalStatus === "timed_out") return true
  if (!hasRequiredOutcomeSummary(messagePreview)) return true
  return /\b(unable to proceed|cannot proceed|need access|waiting on)\b/.test(lowerPreview)
}

function deriveConfigBlocker(investigationRecord, messagePreview) {
  if (investigationRecord?.diagnosisCode === "missing_vercel_token") {
    return {
      credential: "VERCEL_TOKEN (or VERCEL_API_TOKEN / VERCEL_AUTH_TOKEN)",
      detail: "No Vercel API token is configured for live deployment inspection.",
      nextStep: investigationRecord.nextStep,
    }
  }

  if (/missing credential|missing token|configure_vercel_token/i.test(messagePreview || "")) {
    return {
      credential: "Required credential not configured",
      detail: "The worker reported a missing credential and cannot continue safely.",
      nextStep: "Add the missing credential, then re-run the worker.",
    }
  }

  return null
}

function classifyOutcome(finalJob, messagePreview, investigationRecord, headAfter, changedFiles = [], logPreview = "") {
  const lowerPreview = (messagePreview || "").toLowerCase()
  const lowerLog = (logPreview || "").toLowerCase()
  const completedLabel = finalJob.type === "system_task" ? "Codex worker completed the requested system improvement." : "Codex worker completed the requested project task."
  const configBlocker = deriveConfigBlocker(investigationRecord, messagePreview)

  if (configBlocker) {
    return {
      jobStatus: "blocked_on_config",
      summary: `Worker is blocked on configuration: ${configBlocker.credential}.`,
      configBlocker,
    }
  }

  if (shouldTreatUsageLimitAsBlocking(finalJob.status, messagePreview, lowerLog)) {
    return {
      jobStatus: "blocked",
      summary: "Codex worker is blocked by the current Codex usage limit. Restore available credits or wait for the limit reset before retrying this fix.",
      configBlocker: null,
    }
  }

  if (shouldTreatRuntimeAuthAsBlocking(finalJob.status, messagePreview, lowerLog)) {
    return {
      jobStatus: "blocked",
      summary: "Codex worker is blocked because the runtime authentication is not valid for model execution.",
      configBlocker: null,
    }
  }

  if (finalJob.status === "failed" || finalJob.status === "timed_out") {
    return {
      jobStatus: "blocked",
      summary: "Codex worker ended in a blocked state. Check the log and governance files for details.",
      configBlocker: null,
    }
  }

  if (finalJob.status === "cancelled") {
    return {
      jobStatus: "cancelled",
      summary: "Worker was cancelled before completion.",
      configBlocker: null,
    }
  }

  if (/ceo|escalat|approve|decision needed/.test(lowerPreview)) {
    return {
      jobStatus: "awaiting_ceo",
      summary: "Codex worker completed and surfaced a CEO decision.",
      configBlocker: null,
    }
  }

  if (shouldTreatMessageAsBlocked(finalJob.status, messagePreview, lowerPreview)) {
    return {
      jobStatus: "blocked",
      summary: "Codex worker completed its investigation but remains blocked on the next step.",
      configBlocker: null,
    }
  }

  if (!hasRequiredOutcomeSummary(messagePreview)) {
    return {
      jobStatus: "blocked",
      summary: "Worker finished without the required outcome summary and verification sections.",
      configBlocker: null,
    }
  }

  if (finalJob.runTemplate === "fix_issue" && (!headAfter || headAfter === (finalJob.initialGitHead || ""))) {
    return {
      jobStatus: "blocked",
      summary: "Fix run finished without a new git commit, so the fix cannot be trusted as complete.",
      configBlocker: null,
    }
  }

  if (finalJob.runTemplate === "fix_issue" && (!Array.isArray(changedFiles) || changedFiles.length === 0)) {
    return {
      jobStatus: "blocked",
      summary: "Fix run finished without any file changes, so it cannot be trusted as a real fix.",
      configBlocker: null,
    }
  }

  return {
    jobStatus: "completed",
    summary: completedLabel,
    configBlocker: null,
  }
}

module.exports = {
  hasRequiredOutcomeSummary,
  deriveConfigBlocker,
  classifyOutcome,
}
