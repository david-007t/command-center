import { promises as fs } from "fs"
import path from "path"
import { getProjectStatus, type ProjectStatus } from "@/lib/project-status"
import { deriveCompactionHealth } from "@/lib/command-center-guardrails"
import { resolveProjectDir } from "@/lib/managed-projects"

export type ProjectContextPack = {
  projectName: string
  generatedAt: string
  freshness: "fresh" | "stale"
  health: "healthy" | "watch" | "overloaded"
  approximateTokens: number
  summary: string
  architecture: string[]
  currentState: string[]
  activeRisks: string[]
  recommendedNextMove: string
  recentEvidence: string[]
  conversationGuidance: string[]
  compactedMemory: string[]
  sourceFootprintTokens: number
  compressionRatio: number
  compactionRecommendedAction: string
}

function section(markdown: string, title: string) {
  return markdown.match(new RegExp(`## ${title}([\\s\\S]*?)(\\n## |$)`))?.[1]?.trim() ?? ""
}

function bullets(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") || /^\d+\./.test(line))
    .map((line) => line.replace(/^- /, "").replace(/^\d+\.\s*/, ""))
    .filter(Boolean)
}

function firstParagraph(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? ""
}

function dedupe(items: string[]) {
  return [...new Set(items.filter(Boolean))]
}

function summarizeArchitecture(spec: string, decisions: string) {
  return dedupe([
    firstParagraph(section(spec, "Goal")) || firstParagraph(spec),
    ...bullets(section(spec, "Technical approach")).slice(0, 4),
    ...bullets(section(decisions, "Decision log")).slice(0, 3),
  ]).slice(0, 6)
}

function summarizeCurrentState(project: ProjectStatus, tasks: string, handoff: string) {
  return dedupe([
    project.sprintGoal,
    project.nextAction,
    ...project.inProgress.slice(0, 3),
    ...project.upNext.slice(0, 3),
    ...bullets(section(tasks, "In progress")).slice(0, 3),
    ...project.latestHandoff.nextSteps.slice(0, 3),
    firstParagraph(section(handoff, "What is working")),
  ]).slice(0, 8)
}

function summarizeRisks(project: ProjectStatus, errors: string) {
  return dedupe([
    project.blocker,
    project.activeError.description,
    project.activeError.impact,
    ...project.blockedItems.slice(0, 3),
    ...bullets(section(errors, "Active errors")).slice(0, 4),
  ]).slice(0, 6)
}

function summarizeEvidence(project: ProjectStatus) {
  return dedupe([
    ...(project.runtimeState?.trust.checks.map((check) => `${check.label}: ${check.detail}`) ?? []),
    ...(project.investigation?.checks ?? []),
    ...(project.investigation?.evidence?.map((item) => `${item.label}: ${item.detail}`) ?? []),
    ...(project.jobs.slice(0, 2).map((job) => job.executiveMessage || job.summary) ?? []),
  ]).slice(0, 8)
}

function conversationGuidance(project: ProjectStatus) {
  return dedupe([
    `Start from ${project.name}'s current runtime state and governance, not generic portfolio context.`,
    "Prefer the context pack over replaying long raw histories unless the user explicitly asks for source text.",
    "State what is confirmed, inferred, and unverified when discussing project status.",
    project.investigation
      ? `Keep the latest investigation in mind: ${project.investigation.title}.`
      : "",
    project.runtimeState?.trust.level === "confirmed"
      ? "Latest trust state is confirmed, so avoid re-questioning already proven facts unless fresh evidence appears."
      : "Trust is not fully confirmed, so lead with evidence and uncertainty.",
  ]).slice(0, 5)
}

function summarizeCompactedMemory(project: ProjectStatus) {
  return dedupe([
    ...project.jobs.slice(0, 3).flatMap((job) => [job.summary, job.executiveMessage, job.commentaryPreview]),
    project.latestHandoff.whatWorks,
    project.latestHandoff.whatIsBroken,
    ...project.latestHandoff.nextSteps,
  ])
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8)
}

export function getProjectContextPackPath(developerPath: string, projectName: string) {
  return path.join(developerPath, "_system", "runtime", "context-packs", `${projectName}.json`)
}

export async function buildProjectContextPack(developerPath: string, projectName: string) {
  const projectDir = resolveProjectDir(developerPath, projectName)
  const [project, spec, tasks, handoff, errors, decisions] = await Promise.all([
    getProjectStatus(projectName),
    fs.readFile(path.join(projectDir, "SPEC.md"), "utf8").catch(() => ""),
    fs.readFile(path.join(projectDir, "TASKS.md"), "utf8").catch(() => ""),
    fs.readFile(path.join(projectDir, "HANDOFF.md"), "utf8").catch(() => ""),
    fs.readFile(path.join(projectDir, "ERRORS.md"), "utf8").catch(() => ""),
    fs.readFile(path.join(projectDir, "DECISIONS.md"), "utf8").catch(() => ""),
  ])

  const summary = `${project.name} is in ${project.phase} at ${project.progress}% with the current focus on ${project.nextAction}`
  const architecture = summarizeArchitecture(spec, decisions)
  const currentState = summarizeCurrentState(project, tasks, handoff)
  const activeRisks = summarizeRisks(project, errors)
  const recentEvidence = summarizeEvidence(project)
  const conversation = conversationGuidance(project)
  const compactedMemory = summarizeCompactedMemory(project)
  const sourceFootprintTokens = Math.ceil(
    JSON.stringify({
      spec,
      tasks,
      handoff,
      errors,
      decisions,
      jobs: project.jobs.map((job) => ({
        summary: job.summary,
        commentaryPreview: job.commentaryPreview,
        executiveMessage: job.executiveMessage,
      })),
    }).length / 4,
  )
  const approximateTokens = Math.ceil(
    JSON.stringify({
      summary,
      architecture,
      currentState,
      activeRisks,
      recentEvidence,
      conversation,
      compactedMemory,
    }).length / 4,
  )
  const compaction = deriveCompactionHealth(approximateTokens)

  const pack: ProjectContextPack = {
    projectName,
    generatedAt: new Date().toISOString(),
    freshness: "fresh",
    health: compaction.health,
    approximateTokens,
    summary,
    architecture,
    currentState,
    activeRisks,
    recommendedNextMove: `${project.recommendedAction.label}: ${project.recommendedAction.reason}`,
    recentEvidence,
    conversationGuidance: conversation,
    compactedMemory,
    sourceFootprintTokens,
    compressionRatio: sourceFootprintTokens > 0 ? Number((approximateTokens / sourceFootprintTokens).toFixed(2)) : 1,
    compactionRecommendedAction: compaction.recommendedAction,
  }

  const filePath = getProjectContextPackPath(developerPath, projectName)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(pack, null, 2) + "\n", "utf8")
  return pack
}

export async function readProjectContextPack(developerPath: string, projectName: string) {
  const filePath = getProjectContextPackPath(developerPath, projectName)
  const raw = await fs.readFile(filePath, "utf8").catch(() => "")
  return raw ? (JSON.parse(raw) as ProjectContextPack) : null
}

export async function ensureProjectContextPack(developerPath: string, projectName: string) {
  const existing = await readProjectContextPack(developerPath, projectName)
  if (!existing) {
    return buildProjectContextPack(developerPath, projectName)
  }

  const ageMs = Date.now() - new Date(existing.generatedAt).getTime()
  if (ageMs > 15 * 60 * 1000) {
    const refreshed = await buildProjectContextPack(developerPath, projectName)
    return { ...refreshed, freshness: "stale" as const }
  }

  return existing
}
