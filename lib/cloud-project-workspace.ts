import { execFile } from "child_process"
import { promises as fs } from "fs"
import path from "path"
import { promisify } from "util"

const execFileAsync = promisify(execFile)
const COMMAND_CENTER_PROJECT = "command-center"

const DEFAULT_PROJECT_REPOSITORIES: Record<string, string> = {
  anelo: "https://github.com/david-007t/anello.git",
  leadqual: "https://github.com/david-007t/lead-qualifier.git",
  pulse: "https://github.com/david-007t/pulse-app.git",
}

const DEFAULT_PROJECT_BRANCHES: Record<string, string> = {
  anelo: "stage",
  leadqual: "main",
  pulse: "main",
}

export class CloudProjectWorkspaceError extends Error {
  readonly projectName: string
  readonly nextStep: string

  constructor(message: string, projectName: string, nextStep: string) {
    super(message)
    this.name = "CloudProjectWorkspaceError"
    this.projectName = projectName
    this.nextStep = nextStep
  }
}

function parseJsonRecord(value: string | undefined) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([key, item]) => [key.toLowerCase(), item]),
    )
  } catch {
    return {}
  }
}

function parseListRecord(value: string | undefined) {
  if (!value) return {}
  return Object.fromEntries(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=")
        if (separator <= 0) return null
        return [entry.slice(0, separator).trim().toLowerCase(), entry.slice(separator + 1).trim()]
      })
      .filter((entry): entry is [string, string] => Boolean(entry?.[0] && entry?.[1])),
  )
}

function configuredProjectRepositories(env: NodeJS.ProcessEnv = process.env) {
  return {
    ...DEFAULT_PROJECT_REPOSITORIES,
    ...parseListRecord(env.PROJECT_REPOSITORIES),
    ...parseJsonRecord(env.PROJECT_REPOSITORIES_JSON),
  }
}

function configuredProjectBranches(env: NodeJS.ProcessEnv = process.env) {
  return {
    ...DEFAULT_PROJECT_BRANCHES,
    ...parseListRecord(env.PROJECT_BRANCHES),
    ...parseJsonRecord(env.PROJECT_BRANCHES_JSON),
  }
}

function isRailwayRuntime(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID)
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function ensureProjectWorkspace(params: {
  developerPath: string
  projectName: string
  env?: NodeJS.ProcessEnv
}) {
  const env = params.env ?? process.env
  const projectName = params.projectName.toLowerCase()
  const projectDir = projectName === COMMAND_CENTER_PROJECT ? process.cwd() : path.join(params.developerPath, projectName)

  if (projectName === COMMAND_CENTER_PROJECT) return projectDir
  if (await pathExists(projectDir)) return projectDir
  if (!isRailwayRuntime(env)) return projectDir

  const repositories = configuredProjectRepositories(env)
  const repoUrl = repositories[projectName]
  if (!repoUrl) {
    throw new CloudProjectWorkspaceError(
      `No cloud repository is configured for ${projectName}.`,
      projectName,
      `Set PROJECT_REPOSITORIES_JSON with a ${projectName} repository URL, then retry the run.`,
    )
  }

  const branch = configuredProjectBranches(env)[projectName]
  await fs.mkdir(path.dirname(projectDir), { recursive: true })
  const args = ["clone", "--depth=1"]
  if (branch) args.push("--branch", branch)
  args.push(repoUrl, projectDir)
  await execFileAsync("git", args, {
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  })

  return projectDir
}
