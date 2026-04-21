type RuntimeJob = {
  id: string
  status: string
  createdAt: string
  completedAt: string | null
  instruction: string
  summary: string
  currentStage: string
  stageUpdatedAt: string
}

type ProjectStatusLike = {
  runtimeState: {
    status: string
    summary: string
    completedAt: string | null
    currentStage?: string | null
  } | null
  jobs: Array<{ id: string }>
  investigation: {
    summary: string
    likelyCause: string
    nextStep: string
  } | null
  ceoDecision: {
    title: string
    reason: string
    recommendation: string
  } | null
  blocker: string
  nextAction: string
  recommendedAction: {
    reason: string
  }
  activeError: {
    description: string
  }
}

function stageLabel(stage: string | null) {
  if (!stage) return "unknown stage"
  return stage.replaceAll("_", " ")
}

function buildProjectStatusBaseReply(projectName: string, jobs: RuntimeJob[], projectStatus: Pick<ProjectStatusLike, "runtimeState" | "jobs">) {
  if (!jobs.length) {
    const runtimeState = projectStatus.runtimeState
    const latestProjectJob = projectStatus.jobs[0] ?? null

    if (!runtimeState && !latestProjectJob) {
      return `${projectName} has no worker runs yet in this chat thread.`
    }

    return [
      `${projectName} project status is available even though this chat thread has no attached worker runs yet.`,
      runtimeState ? `Project runtime status: ${runtimeState.status}.` : null,
      latestProjectJob ? `Latest project job: ${latestProjectJob.id}.` : null,
      runtimeState?.currentStage ? `Current stage: ${stageLabel(runtimeState.currentStage)}.` : null,
      runtimeState?.completedAt ? `Completed at ${runtimeState.completedAt}.` : null,
      `Summary: ${runtimeState?.summary?.trim() || "No summary recorded."}`,
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

export function isLikelyQueueBlockerRequest(input: string) {
  return /\b(why is it still queued|why is .* queued|still queued|what'?s stopping|whats stopping|why isn'?t it running|why is it waiting|stuck in queue|stuck queued)\b/i.test(
    input,
  )
}

export function isLikelyProjectNeedsRequest(input: string) {
  return /\b(what does .* need right now|what do you need from me|what needs my attention|top blocker|what'?s blocking|whats blocking|what should i do next|what needs to happen next)\b/i.test(
    input,
  )
}

export function buildWorkerRunnerUnavailableReply(projectName: string, latestJob?: Pick<RuntimeJob, "id" | "status"> | null) {
  return [
    `${projectName} is waiting on the local worker runner, not on a hidden AI decision.`,
    latestJob?.status === "queued" && latestJob.id ? `Queued job: ${latestJob.id}.` : null,
    "What is blocking it: the Inngest dev runner is not reachable, so queued jobs have no active consumer.",
    "Next step: start the local Inngest dev runner and then retry or re-launch the queued work.",
  ]
    .filter(Boolean)
    .join("\n")
}

export function buildProjectNeedsReply(
  projectName: string,
  projectStatus: Pick<ProjectStatusLike, "runtimeState" | "investigation" | "ceoDecision" | "blocker" | "nextAction" | "recommendedAction" | "activeError">,
) {
  if (projectStatus.ceoDecision) {
    return [
      `${projectName} needs your decision before more work should launch.`,
      `Decision: ${projectStatus.ceoDecision.title}.`,
      `Why it stopped: ${projectStatus.ceoDecision.reason}`,
      `Recommended next move: ${projectStatus.ceoDecision.recommendation}`,
    ].join("\n")
  }

  if (projectStatus.investigation) {
    return [
      `${projectName} needs the current blocker resolved before normal feature work continues.`,
      `Top blocker: ${projectStatus.investigation.summary}`,
      `Likely cause: ${projectStatus.investigation.likelyCause}`,
      `Next fix: ${projectStatus.investigation.nextStep}`,
    ].join("\n")
  }

  return [
    `${projectName} does not currently have a recorded CEO decision or active investigation.`,
    `Runtime: ${projectStatus.runtimeState?.status ?? "unknown"}.`,
    `Top blocker: ${projectStatus.activeError.description || projectStatus.blocker || "No explicit blocker is recorded."}`,
    `Next move: ${projectStatus.nextAction || projectStatus.recommendedAction.reason}`,
  ].join("\n")
}

export function buildProjectStatusReplyWithRunner(
  projectName: string,
  jobs: RuntimeJob[],
  projectStatus: Pick<ProjectStatusLike, "runtimeState" | "jobs">,
  runnerAvailable: boolean,
) {
  const baseReply = buildProjectStatusBaseReply(projectName, jobs, projectStatus)
  const latestJob = jobs
    .slice()
    .sort((left, right) => {
      const leftTime = left.completedAt ?? left.stageUpdatedAt ?? left.createdAt
      const rightTime = right.completedAt ?? right.stageUpdatedAt ?? right.createdAt
      return rightTime.localeCompare(leftTime)
    })[0]

  if (!runnerAvailable && latestJob?.status === "queued") {
    return `${baseReply}\n\n${buildWorkerRunnerUnavailableReply(projectName, latestJob)}`
  }

  return baseReply
}
