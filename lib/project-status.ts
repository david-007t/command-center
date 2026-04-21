import { promises as fs } from "fs"
import path from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import {
  getDeveloperPath,
  listJobs,
  readCommentaryPreview,
  readLogPreview,
  readMessagePreview,
  readProjectRuntimeState,
  summarizeRecommendedAction,
} from "@/lib/orchestration"
import {
  executiveDecisionFromRuntime,
  executiveStatusLabel,
  executiveizeError,
  executiveizeHandoff,
  executiveizeLatestOutcome,
  executiveizeRuntimeMessage,
  executiveizeTaskItem,
  executiveRuntimeSummary,
  executiveizeBlocker,
  executiveizeNextAction,
  executiveizeText,
} from "@/lib/executive"
import { readInvestigationRecord, type InvestigationRecord } from "@/lib/project-investigation"
import { getPortfolioPath, readPortfolioProjectsWithCommandCenter, resolveProjectDir } from "@/lib/managed-projects"
import { summarizeTrustChecks, type TrustCheck, type TrustSummary } from "@/lib/project-trust"

const execFileAsync = promisify(execFile)

export type Job = {
  id: string
  type: "project_task" | "orchestrator_run" | "system_task"
  runTemplate: RunTemplate | null
  projectName: string | null
  instruction: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out" | "awaiting_ceo" | "blocked" | "blocked_on_config"
  statusLabel: string
  createdAt: string
  completedAt: string | null
  summary: string
  messagePreview: string
  commentaryPreview: string
  executiveMessage: string
  logPreview: string
  logPath: string
  successCriteria: string[]
  governanceTargets: string[]
  currentStage: string
  stageUpdatedAt: string
}

export type RunTemplate = "custom" | "continue_project" | "fix_blocker" | "fix_issue" | "review_next_move" | "prep_qa" | "investigate_issue"

export type InvestigationSummary = {
  title: string
  summary: string
  checks: string[]
  likelyCause: string
  nextStep: string
  diagnosisCode?: string
  recommendedAction?: {
    kind: string
    summary: string
  }
  deploymentDetails?: {
    branch: string
    state: string
    commitSha: string | null
    url: string | null
    createdAt: string | null
  }
  proofSummary?: {
    verified: string[]
    inferred: string[]
    blocked: string[]
  }
  canAutofix: boolean
  suggestedTemplate: RunTemplate
  suggestedInstruction: string
  status?: "healthy" | "needs_attention" | "blocked"
  autonomyMode?: "can_autofix" | "needs_review" | "needs_ceo_approval"
  autonomyRationale?: string
  evidence?: Array<{
    label: string
    status: string
    source: string
    detail: string
    url?: string
  }>
  actions?: Array<{
    kind: string
    status: string
    summary: string
  }>
}

export type ProjectStatus = {
  name: string
  phase: string
  progress: number
  blocker: string
  nextAction: string
  launchTarget: string
  sprintGoal: string
  inProgress: string[]
  blockedItems: string[]
  upNext: string[]
  latestHandoff: {
    whatWorks: string
    whatIsBroken: string
    nextSteps: string[]
  }
  activeError: {
    description: string
    impact: string
  }
  ceoDecision: {
    projectName: string
    title: string
    reason: string
    recommendation: string
    explanation?: string
    evidence?: string[]
    options?: Array<{
      id: string
      label: string
      description: string
      impact: string
      summary?: string
      workflow?: string[]
      files?: string[]
      whyThisMatters?: string
      risk?: string
    }>
    defaultOptionId?: string | null
    priority: "critical" | "important"
    source: "runtime" | "portfolio"
  } | null
  recommendedAction: {
    template: RunTemplate
    label: string
    reason: string
  }
  investigation: InvestigationSummary | null
  runtimeState: {
    projectName: string
    jobId: string
    runTemplate: string | null
    status: "healthy" | "stale_governance" | "awaiting_ceo" | "blocked" | "blocked_on_config" | "cancelled"
    statusLabel: string
    summary: string
    configBlocker?: {
      credential: string
      detail: string
      nextStep: string
    } | null
    governanceUpdated: boolean
    governanceTargets: string[]
    updatedTargets: string[]
    missingTargets: string[]
    completedAt: string | null
    messagePreview: string
    currentStage: string | null
    stageUpdatedAt: string | null
    trust: TrustSummary
  } | null
  jobs: Job[]
}

export { summarizeTrustChecks, type TrustCheck, type TrustSummary } from "@/lib/project-trust"

type RuntimePresentationState = {
  projectName: string
  jobId: string
  runTemplate: string | null
  status: "healthy" | "stale_governance" | "awaiting_ceo" | "blocked" | "blocked_on_config" | "cancelled"
  statusLabel: string
  summary: string
  configBlocker?: {
    credential: string
    detail: string
    nextStep: string
  } | null
  governanceUpdated: boolean
  governanceTargets: string[]
  updatedTargets: string[]
  missingTargets: string[]
  completedAt: string | null
  messagePreview: string
  currentStage: string | null
  stageUpdatedAt: string | null
  rawMessagePreview: string
}

function section(markdown: string, title: string) {
  return markdown.match(new RegExp(`## ${title}([\\s\\S]*?)(\\n## |$)`))?.[1]?.trim() ?? ""
}

function listItems(content: string) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim())
}

function firstParagraph(content: string) {
  return content.split("\n").map((line) => line.trim()).find(Boolean) ?? ""
}

async function parsePortfolioRow(developerPath: string, markdown: string, projectName: string) {
  const row = (await readPortfolioProjectsWithCommandCenter(developerPath, markdown)).find((project) => project.name === projectName)

  if (!row) {
    return {
      phase: "UNKNOWN",
      progress: 0,
      blocker: "Not found in portfolio",
      nextAction: "Update PORTFOLIO.md",
      launchTarget: "TBD",
    }
  }

  return {
    phase: row.phase ?? "UNKNOWN",
    progress: row.progress ?? 0,
    blocker: row.blocker ?? "",
    nextAction: row.nextAction ?? "",
    launchTarget: row.launchTarget ?? "",
  }
}

function parseLatestHandoffSummary(markdown: string) {
  const whatWorks = executiveizeHandoff(firstParagraph(section(markdown, "What is working")))
  const whatIsBroken = executiveizeHandoff(firstParagraph(section(markdown, "What is not working")))
  const nextSteps = section(markdown, "What the next agent should do first")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\./.test(line))
    .map((line) => line.replace(/^\d+\.\s*/, ""))
    .map((line) => executiveizeTaskItem(line))

  return {
    whatWorks,
    whatIsBroken,
    nextSteps,
  }
}

function parseTasks(markdown: string) {
  return {
    sprintGoal: executiveizeText(firstParagraph(section(markdown, "Current sprint goal"))),
    inProgress: listItems(section(markdown, "In progress")).map((item) => executiveizeTaskItem(item)),
    blocked: listItems(section(markdown, "Blocked")).map((item) => executiveizeTaskItem(item)),
    upNext: listItems(section(markdown, "Up next")).map((item) => executiveizeTaskItem(item)),
  }
}

function parseErrors(markdown: string) {
  const active = section(markdown, "Active errors")
  const firstError = active.split("\n").map((line) => line.trim()).find((line) => line.startsWith("- Description:"))
  const impact = active.split("\n").map((line) => line.trim()).find((line) => line.startsWith("- Impact:"))

  return executiveizeError(firstError?.replace("- Description:", "").trim() ?? "", impact?.replace("- Impact:", "").trim() ?? "")
}

async function safeGit(projectDir: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectDir, ...args])
    return stdout.trim()
  } catch {
    return ""
  }
}

async function deriveRuntimeTrust(
  projectDir: string,
  runtimeState: RuntimePresentationState,
  investigationRecord?: InvestigationRecord | null,
) {
  const checks: TrustCheck[] = []
  const combinedText = `${runtimeState.summary}\n${runtimeState.rawMessagePreview}\n${runtimeState.messagePreview}`.toLowerCase()

  if (runtimeState.governanceUpdated) {
    checks.push({
      label: "Governance refresh",
      status: "confirmed",
      source: "governance",
      detail: "The expected project records were updated during the latest run.",
    })
  } else {
    checks.push({
      label: "Governance refresh",
      status: "unverified",
      source: "governance",
      detail: "The expected project records are not fully aligned with the latest run yet.",
    })
  }

  if (investigationRecord?.trustChecks?.length) {
    checks.push(...investigationRecord.trustChecks)
    return summarizeTrustChecks(checks)
  }

  const currentBranch = await safeGit(projectDir, ["branch", "--show-current"])
  const upstream = await safeGit(projectDir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
  const stageRemoteRef = await safeGit(projectDir, ["rev-parse", "--verify", "refs/remotes/origin/stage"])

  if (/stage|preview deployment|vercel|branch split|origin\/stage/.test(combinedText)) {
    if (currentBranch === "stage" && upstream === "origin/stage" && Boolean(stageRemoteRef)) {
      checks.push({
        label: "Git branch wiring",
        status: "confirmed",
        source: "local_repo",
        detail: "Local git state shows the workspace on stage and tracking origin/stage.",
      })
    } else if (currentBranch === "stage" || upstream === "origin/stage") {
      checks.push({
        label: "Git branch wiring",
        status: "inferred",
        source: "local_repo",
        detail: "Local git state suggests stage wiring exists, but the full local proof is incomplete.",
      })
    }

    if (/not yet|not been observed|not observed|not confirmed|preview deployment has not/.test(combinedText)) {
      checks.push({
        label: "Stage preview deployment",
        status: "unverified",
        source: "external_deploy",
        detail: "No stage preview deployment has been externally verified yet.",
      })
    } else if (/preview deployment|vercel/.test(combinedText)) {
      checks.push({
        label: "Stage preview deployment",
        status: "inferred",
        source: "worker_report",
        detail: "A worker reported deployment progress, but the app does not yet have external deployment proof.",
      })
    }
  }

  if (!checks.length) {
    checks.push({
      label: "Latest runtime report",
      status: "inferred",
      source: "runtime_record",
      detail: "This status currently relies on the worker report stored in runtime records.",
    })
  }

  return summarizeTrustChecks(checks)
}

function deriveInvestigation(
  projectName: string,
  trust: TrustSummary,
  runtimeState?: RuntimePresentationState | null,
  investigationRecord?: InvestigationRecord | null,
): InvestigationSummary | null {
  if (investigationRecord && (investigationRecord.status !== "healthy" || trust.level !== "confirmed")) {
    return {
      title: investigationRecord.title,
      summary: investigationRecord.summary,
      checks: investigationRecord.checks,
      likelyCause: investigationRecord.likelyCause,
      nextStep: investigationRecord.nextStep,
      diagnosisCode: investigationRecord.diagnosisCode,
      recommendedAction: investigationRecord.recommendedAction,
      deploymentDetails: investigationRecord.deploymentDetails,
      proofSummary: investigationRecord.proofSummary,
      canAutofix: investigationRecord.canAutofix,
      suggestedTemplate: "investigate_issue",
      suggestedInstruction: investigationRecord.suggestedInstruction,
      status: investigationRecord.status,
      evidence: investigationRecord.evidence,
      actions: investigationRecord.actions,
    }
  }

  const stagePreviewGap = trust.checks.find((check) => check.label === "Stage preview deployment" && check.status === "unverified")
  if (stagePreviewGap) {
    return {
      title: "Investigate missing stage preview",
      summary: "The branch split looks real locally, but the first stage preview deployment is still not externally verified.",
      checks: [
        "Confirmed the local repo is on stage and tracking origin/stage.",
        "Confirmed governance records were refreshed during the last run.",
        "Detected that no external stage preview deployment has been verified yet.",
      ],
      likelyCause:
        "The most likely cause is that Vercel has not created or exposed the first preview deployment for stage yet, or the first branch-triggered preview did not fire cleanly.",
      nextStep:
        "Run an evidence-first deployment investigation: inspect Vercel deployment state for stage, and if no preview exists, trigger one safe fresh build from stage before re-checking the preview URL.",
      canAutofix: true,
      suggestedTemplate: "investigate_issue",
      suggestedInstruction:
        `Investigate why ${projectName} does not yet have a verified Vercel stage preview deployment. Treat local git stage wiring as already confirmed. Check what evidence exists for the preview deployment, identify the most likely cause, and if it is low-risk, trigger the narrowest safe action to force or verify the first stage preview build before updating TASKS.md, ERRORS.md, and HANDOFF.md.`,
    }
  }

  if (runtimeState?.status === "blocked" || runtimeState?.status === "stale_governance") {
    return {
      title: "Investigate project blocker",
      summary: "The latest runtime state is blocked or stale, so the system should diagnose the cause before continuing product work.",
      checks: [
        "Review the latest runtime message and job outcome.",
        "Inspect the most recent log evidence.",
        "Compare governance targets to what was actually updated.",
      ],
      likelyCause:
        runtimeState.status === "stale_governance"
          ? "The likely cause is that the worker finished but did not fully refresh the expected governance files."
          : "The likely cause is that the last run hit an execution blocker that still needs a concrete root-cause diagnosis.",
      nextStep:
        "Run a structured investigation to identify the exact cause, then either make the narrowest safe fix or return with a concrete operator recommendation.",
      canAutofix: true,
      suggestedTemplate: "investigate_issue",
      suggestedInstruction:
        `Investigate the current blocker in ${projectName}. Review the latest runtime record, job logs, and governance files. Identify the exact root cause, make the narrowest safe fix if one is available, verify the result, and update TASKS.md, ERRORS.md, and HANDOFF.md.`,
    }
  }

  return null
}

export async function getProjectStatus(projectName: string): Promise<ProjectStatus> {
  const developerPath = getDeveloperPath()
  const projectDir = resolveProjectDir(developerPath, projectName)
  await fs.access(projectDir)

  const [portfolio, tasks, handoff, errors] = await Promise.all([
    fs.readFile(getPortfolioPath(developerPath), "utf8").catch(() => ""),
    fs.readFile(path.join(projectDir, "TASKS.md"), "utf8").catch(() => ""),
    fs.readFile(path.join(projectDir, "HANDOFF.md"), "utf8").catch(() => ""),
    fs.readFile(path.join(projectDir, "ERRORS.md"), "utf8").catch(() => ""),
  ])

  const jobs = await listJobs(developerPath, projectName)
  const runtimeState = await readProjectRuntimeState(developerPath, projectName)
  const investigationRecord = await readInvestigationRecord(developerPath, projectName)
  const ceoDecision = runtimeState ? executiveDecisionFromRuntime(projectName, runtimeState) : null
  const enrichedJobs = await Promise.all(
    jobs.slice(0, 8).map(async (job) => ({
      ...job,
      statusLabel: executiveStatusLabel(job.status),
      messagePreview: executiveizeText(await readMessagePreview(job.messagePath)),
      commentaryPreview: executiveizeText(await readCommentaryPreview(job.commentaryPath)),
      executiveMessage: executiveizeLatestOutcome(await readMessagePreview(job.messagePath) || job.summary),
      logPreview: executiveizeText(await readLogPreview(job.logPath)),
    })),
  )

  const portfolioState = await parsePortfolioRow(developerPath, portfolio, projectName)
  const taskState = parseTasks(tasks)
  const handoffState = parseLatestHandoffSummary(handoff)
  const errorState = parseErrors(errors)
  const presentedRuntimeState = runtimeState
    ? {
        ...runtimeState,
        statusLabel: executiveStatusLabel(runtimeState.status),
        summary: executiveRuntimeSummary(runtimeState),
        messagePreview: executiveizeRuntimeMessage(runtimeState),
        trust: await deriveRuntimeTrust(projectDir, {
          ...runtimeState,
          statusLabel: executiveStatusLabel(runtimeState.status),
          summary: executiveRuntimeSummary(runtimeState),
          messagePreview: executiveizeRuntimeMessage(runtimeState),
          rawMessagePreview: runtimeState.messagePreview,
        }, investigationRecord),
      }
    : null
  const recommendedAction =
    presentedRuntimeState?.trust.level === "unverified"
      ? {
          template: "investigate_issue" as RunTemplate,
          label: "Investigate issue",
          reason: "Some important claims are still unverified, so the safest next move is to investigate the missing proof before continuing blindly.",
        }
      : summarizeRecommendedAction(runtimeState)
  const investigation = presentedRuntimeState
    ? deriveInvestigation(projectName, presentedRuntimeState.trust, {
        ...runtimeState!,
        statusLabel: presentedRuntimeState.statusLabel,
        summary: presentedRuntimeState.summary,
        messagePreview: presentedRuntimeState.messagePreview,
        rawMessagePreview: runtimeState!.messagePreview,
      }, investigationRecord)
    : null

  return {
    name: projectName,
    ...portfolioState,
    blocker: executiveizeBlocker(portfolioState.blocker),
    nextAction: executiveizeNextAction(portfolioState.nextAction),
    sprintGoal: taskState.sprintGoal,
    inProgress: taskState.inProgress,
    blockedItems: taskState.blocked,
    upNext: taskState.upNext,
    latestHandoff: handoffState,
    activeError: errorState,
    recommendedAction,
    investigation,
    ceoDecision,
    jobs: enrichedJobs,
    runtimeState: presentedRuntimeState,
  }
}
