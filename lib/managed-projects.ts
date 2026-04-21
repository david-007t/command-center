import { promises as fs } from "fs"
import path from "path"

export const COMMAND_CENTER_PROJECT = "command-center"
export const MANAGED_PROJECTS = [COMMAND_CENTER_PROJECT, "anelo", "leadqual", "pulse", "rbc"] as const

export type PortfolioProjectRecord = {
  name: string
  phase: string
  progress: number
  blocker: string
  nextAction: string
  launchTarget: string
}

function section(markdown: string, title: string) {
  return markdown.match(new RegExp(`## ${title}([\\s\\S]*?)(\\n## |$)`))?.[1]?.trim() ?? ""
}

function bullets(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") || /^\d+\./.test(line))
    .map((line) => line.replace(/^- /, "").replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
}

function firstLine(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? ""
}

function parseManagedStatus(tasksMarkdown: string) {
  const status = section(tasksMarkdown, "Managed status")
  const phase = status.match(/- Phase: (.*)/)?.[1]?.trim() ?? "BUILD"
  const progress = Number((status.match(/- Progress: (.*)/)?.[1] ?? "72").replace("%", "").trim()) || 72
  const launchTarget = status.match(/- Launch target: (.*)/)?.[1]?.trim() ?? "Internal operating system"

  return { phase, progress, launchTarget }
}

export function getCommandCenterRoot() {
  return process.cwd()
}

export function getPortfolioPath(developerPath: string) {
  return path.join(developerPath, "PORTFOLIO.md")
}

export function resolveProjectDir(developerPath: string, projectName: string) {
  return projectName === COMMAND_CENTER_PROJECT ? getCommandCenterRoot() : path.join(developerPath, projectName)
}

export function getProjectFilePath(developerPath: string, projectName: string, fileName: string) {
  return path.join(resolveProjectDir(developerPath, projectName), fileName)
}

export function parsePortfolioProjects(markdown: string) {
  const rows = markdown.match(/\| [^\n]+ \| [^\n]+ \| [^\n]+ \| [^\n]+ \| [^\n]+ \| [^\n]+ \|/g) ?? []
  return rows
    .slice(1)
    .map((row) => row.split("|").map((cell) => cell.trim()).filter(Boolean))
    .map(
      (cells) =>
        ({
          name: cells[0] ?? "",
          phase: cells[1] ?? "PARKED",
          progress: Number(cells[2]?.replace("%", "")) || 0,
          blocker: cells[3] ?? "",
          nextAction: cells[4] ?? "",
          launchTarget: cells[5] ?? "",
        }) satisfies PortfolioProjectRecord,
    )
}

export async function deriveCommandCenterPortfolioRecord(developerPath: string): Promise<PortfolioProjectRecord> {
  const projectDir = resolveProjectDir(developerPath, COMMAND_CENTER_PROJECT)
  const [tasksMarkdown, errorsMarkdown] = await Promise.all([
    fs.readFile(path.join(projectDir, "TASKS.md"), "utf8").catch(() => ""),
    fs.readFile(path.join(projectDir, "ERRORS.md"), "utf8").catch(() => ""),
  ])

  const managed = parseManagedStatus(tasksMarkdown)
  const nextAction = bullets(section(tasksMarkdown, "Up next"))[0] || firstLine(section(tasksMarkdown, "Current sprint goal")) || "Continue Pass 4"
  const blocker =
    errorsMarkdown.match(/- Description: (.*)/)?.[1]?.trim() ||
    bullets(section(tasksMarkdown, "Blocked"))[0] ||
    "No critical blocker recorded."

  return {
    name: COMMAND_CENTER_PROJECT,
    phase: managed.phase,
    progress: managed.progress,
    blocker,
    nextAction,
    launchTarget: managed.launchTarget,
  }
}

export async function readPortfolioProjectsWithCommandCenter(developerPath: string, markdown: string) {
  const parsed = parsePortfolioProjects(markdown)
  if (parsed.some((project) => project.name === COMMAND_CENTER_PROJECT)) {
    return parsed
  }

  return [await deriveCommandCenterPortfolioRecord(developerPath), ...parsed]
}
