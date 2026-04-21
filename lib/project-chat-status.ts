import type { RuntimeJob } from "@/lib/orchestration"
import type { ProjectStatus } from "@/lib/project-status"

export function isLikelyStatusRequest(input: string) {
  return /\b(status|update|still running|still working|did .* finish|finished yet|is it done|what happened|where are we|what's going on)\b/i.test(input)
}

export function isLikelyDecisionRequest(input: string) {
  return /\b(decision needed|what decision|what is the decision|what's the decision|whats the decision|clarify the decision|explain the decision|need my approval|need a decision|what do i need to decide|approval needed)\b/i.test(
    input,
  )
}

export function isLikelyDecisionExplanationRequest(input: string) {
  return /\b(explain the decision|explain this decision|what is the decision|what's the decision|whats the decision|what do you mean|i'?m confused|you haven'?t made it clear|make it clear|clarify)\b/i.test(
    input,
  )
}

export function detectDecisionSelection(input: string, projectName: string) {
  const normalized = input.toLowerCase()

  if (projectName === "leadqual") {
    if (/\b(single[- ]user|keep it single user|make it single user|stay single user|single user v1|scope it single user)\b/i.test(normalized)) {
      return "single_user_v1"
    }
    if (/\b(add auth|implement auth|do auth|multi[- ]user|make it multi user|auth\/rls|rls|protected routes?)\b/i.test(normalized)) {
      return "auth_rls_v1"
    }
  }

  if (projectName === "rbc") {
    if (/\b(pipeline\/run\.py|queue[- ]first|queue first)\b/i.test(normalized)) {
      return "pipeline/run.py"
    }
    if (/\b(run_days\.py|day[- ]compilation|day compilation)\b/i.test(normalized)) {
      return "run_days.py"
    }
  }

  return null
}

function stageLabel(stage: string | null) {
  if (!stage) return "unknown stage"
  return stage.replaceAll("_", " ")
}

function normalizeExecutiveText(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function firstSentence(text: string) {
  const cleaned = normalizeExecutiveText(text)
  const match = cleaned.match(/(.+?[.!?])(\s|$)/)
  return match?.[1]?.trim() ?? cleaned
}

function extractDecisionCall(title: string | undefined, reason: string | undefined) {
  const cleanedTitle = normalizeExecutiveText(title ?? "")
  const cleanedReason = normalizeExecutiveText(reason ?? "")
  const explicitCall = cleanedReason.match(/CEO DECISION NEEDED:\s*(.+?)(?:\.\s|$)/i)?.[1]?.trim()

  if (explicitCall) {
    return /[.!?]$/.test(explicitCall) ? explicitCall : `${explicitCall}.`
  }

  if (cleanedTitle && !/^decision needed$/i.test(cleanedTitle)) {
    return cleanedTitle
  }

  if (!cleanedReason) {
    return "A project decision is waiting on you."
  }

  return firstSentence(cleanedReason)
}

function compactRecommendation(text: string | undefined) {
  const cleaned = normalizeExecutiveText(text ?? "")
  return cleaned ? firstSentence(cleaned) : null
}

function decisionTradeoffExplanation(projectName: string, projectStatus: Pick<ProjectStatus, "ceoDecision" | "runtimeState" | "jobs">) {
  const decision = projectStatus.ceoDecision
  const runtimeState = projectStatus.runtimeState
  const latestJob = projectStatus.jobs[0] ?? null
  const reason = normalizeExecutiveText(decision?.reason ?? runtimeState?.messagePreview ?? runtimeState?.summary ?? "")
  const recommendation = compactRecommendation(decision?.recommendation)

  if (!decision && !runtimeState) {
    return `${projectName} does not currently have a recorded decision waiting on you.`
  }

  if (decision?.options?.length) {
    const recommendedOption = decision.options.find((option) => option.id === decision.defaultOptionId) ?? decision.options[0]
    const otherOptions = decision.options.filter((option) => option.id !== recommendedOption?.id)

    return [
      `Here’s the decision in plain English for ${projectName}.`,
      `The system is paused because it needs you to choose between ${decision.options.length} valid paths before more build work happens.`,
      recommendedOption ? `Recommended path: ${recommendedOption.label}. ${recommendedOption.description}` : null,
      otherOptions[0] ? `Other path: ${otherOptions[0].label}. ${otherOptions[0].description}` : null,
      recommendation ? `Why it recommends that: ${recommendation}` : null,
      latestJob ? `Latest job: ${latestJob.id}.` : null,
    ]
      .filter(Boolean)
      .join("\n")
  }

  if (/single-user|localstorage|auth\/rls|protected-route|authentication/i.test(reason)) {
    return [
      `Here’s the decision in plain English for ${projectName}.`,
      "The app currently behaves like a simple single-user tool, but the QA and security checklist is judging it like a multi-user production app.",
      "Your call is whether v1 should stay a simpler single-user release and have the release gates match that reality, or whether v1 must add auth, protected routes, and RLS before it can be treated as release-ready.",
      recommendation ? `Recommended path: ${recommendation}` : null,
      latestJob ? `Latest job: ${latestJob.id}.` : null,
    ]
      .filter(Boolean)
      .join("\n")
  }

  return [
    `Here’s the decision in plain English for ${projectName}.`,
    extractDecisionCall(decision?.title, decision?.reason),
    recommendation ? `Recommended path: ${recommendation}` : null,
    decision?.explanation ? `Why the system stopped: ${firstSentence(decision.explanation)}` : null,
    latestJob ? `Latest job: ${latestJob.id}.` : null,
  ]
    .filter(Boolean)
    .join("\n")
}

export function buildProjectStatusReply(
  projectName: string,
  jobs: RuntimeJob[],
  projectStatus?: Pick<ProjectStatus, "runtimeState" | "jobs">,
) {
  if (!jobs.length) {
    const runtimeState = projectStatus?.runtimeState
    const latestProjectJob = projectStatus?.jobs[0] ?? null

    if (!runtimeState && !latestProjectJob) {
      return `${projectName} has no worker runs yet in this chat thread.`
    }

    return [
      `${projectName} project status is available even though this chat thread has no attached worker runs yet.`,
      runtimeState ? `Project runtime status: ${runtimeState.status}.` : null,
      latestProjectJob ? `Latest project job: ${latestProjectJob.id}.` : null,
      latestProjectJob?.instruction ? `Instruction: ${latestProjectJob.instruction}` : null,
      runtimeState?.currentStage ? `Current stage: ${stageLabel(runtimeState.currentStage)}.` : null,
      runtimeState?.completedAt ? `Completed at ${runtimeState.completedAt}.` : null,
      `Summary: ${runtimeState?.messagePreview?.trim() || latestProjectJob?.summary?.trim() || "No summary recorded."}`,
    ]
      .filter(Boolean)
      .join("\n")
  }

  const latestJob = jobs
    .slice()
    .sort((left, right) => {
      const leftTime = left.completedAt ?? left.stageUpdatedAt ?? left.createdAt
      const rightTime = right.completedAt ?? right.stageUpdatedAt ?? right.createdAt
      return rightTime.localeCompare(leftTime)
    })[0]

  const completedAt = latestJob.completedAt ? `Completed at ${latestJob.completedAt}.` : null
  const stage = latestJob.status === "running" || latestJob.status === "queued" ? `Current stage: ${stageLabel(latestJob.currentStage)}.` : null
  const summary = latestJob.summary?.trim() || "No summary recorded."

  return [
    `${projectName} latest worker status: ${latestJob.status}.`,
    `Job: ${latestJob.id}.`,
    latestJob.instruction ? `Instruction: ${latestJob.instruction}` : null,
    stage,
    completedAt,
    `Summary: ${summary}`,
  ]
    .filter(Boolean)
    .join("\n")
}

export function buildProjectDecisionReply(
  projectName: string,
  projectStatus: Pick<ProjectStatus, "ceoDecision" | "runtimeState" | "jobs">,
) {
  const decision = projectStatus.ceoDecision
  const runtimeState = projectStatus.runtimeState
  const latestJob = projectStatus.jobs[0] ?? null

  if (!decision && !runtimeState) {
    return `${projectName} does not currently have a recorded decision waiting on you.`
  }

  if (!decision) {
    return [
      `${projectName} does not currently have a named decision record, but the latest runtime state is ${runtimeState?.status ?? "unknown"}.`,
      runtimeState?.completedAt ? `Completed at ${runtimeState.completedAt}.` : null,
      `Summary: ${runtimeState?.messagePreview?.trim() || runtimeState?.summary?.trim() || "No summary recorded."}`,
    ]
      .filter(Boolean)
      .join("\n")
  }

  return [
    `${projectName} needs a decision.`,
    `Call: ${extractDecisionCall(decision.title, decision.reason)}`,
    compactRecommendation(decision.recommendation) ? `Recommendation: ${compactRecommendation(decision.recommendation)}` : null,
    decision.explanation ? `Impact: ${firstSentence(decision.explanation)}` : null,
    latestJob ? `Latest job: ${latestJob.id}.` : null,
    runtimeState?.completedAt ? `Completed at ${runtimeState.completedAt}.` : null,
  ]
    .filter(Boolean)
    .join("\n")
}

export function buildProjectDecisionExplanationReply(
  projectName: string,
  projectStatus: Pick<ProjectStatus, "ceoDecision" | "runtimeState" | "jobs">,
) {
  return decisionTradeoffExplanation(projectName, projectStatus)
}
