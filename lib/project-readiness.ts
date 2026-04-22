import { promises as fs } from "fs"
import path from "path"
import type { ProjectStatus } from "./project-status"

export type ProjectReadinessStatus = "ready" | "missing_setup" | "blocked"

export type ProjectReadinessCheck = {
  id: string
  label: string
  status: "pass" | "missing" | "blocked"
  detail: string
}

export type ProjectReadiness = {
  status: ProjectReadinessStatus
  label: "Ready" | "Missing setup" | "Blocked"
  tone: "emerald" | "amber" | "rose"
  summary: string
  checks: ProjectReadinessCheck[]
}

export type ProjectReadinessInput = {
  repoExists: boolean
  governanceFiles: {
    tasks: boolean
    handoff: boolean
    qa: boolean
    security: boolean
  }
  hasEnvContract: boolean
  hasProductLink: boolean
  hasTestCommand: boolean
  hasDeployPath: boolean
  hasDoNotBreakNotes: boolean
}

function check(id: string, label: string, ok: boolean, detail: string, missingStatus: "missing" | "blocked" = "missing") {
  return {
    id,
    label,
    status: ok ? "pass" as const : missingStatus,
    detail,
  }
}

export function deriveProjectReadiness(input: ProjectReadinessInput): ProjectReadiness {
  const checks: ProjectReadinessCheck[] = [
    check("repo", "Repo path", input.repoExists, input.repoExists ? "Repository path is accessible." : "Repository path is missing.", "blocked"),
    check(
      "tasks",
      "TASKS.md",
      input.governanceFiles.tasks,
      input.governanceFiles.tasks ? "Task contract is present." : "TASKS.md is required before workers run.",
      "blocked",
    ),
    check(
      "handoff",
      "HANDOFF.md",
      input.governanceFiles.handoff,
      input.governanceFiles.handoff ? "Handoff context is present." : "HANDOFF.md is required before workers run.",
      "blocked",
    ),
    check(
      "qa",
      "QA checklist",
      input.governanceFiles.qa,
      input.governanceFiles.qa ? "QA checklist is present." : "QA_CHECKLIST.md should define product test expectations.",
    ),
    check(
      "security",
      "Security checklist",
      input.governanceFiles.security,
      input.governanceFiles.security ? "Security checklist is present." : "SECURITY_CHECKLIST.md should capture release risks.",
    ),
    check(
      "env_contract",
      "Env contract",
      input.hasEnvContract,
      input.hasEnvContract ? "Environment expectations are documented." : "Add .env.example or document required secrets.",
    ),
    check(
      "product_link",
      "Product link",
      input.hasProductLink,
      input.hasProductLink ? "Command Center has a product or test URL." : "No durable product/test URL is connected yet.",
    ),
    check(
      "test_command",
      "Test command",
      input.hasTestCommand,
      input.hasTestCommand ? "A test script or checklist exists." : "Add a package test script or explicit test checklist.",
    ),
    check(
      "deploy_path",
      "Deploy path",
      input.hasDeployPath,
      input.hasDeployPath ? "Deploy path is discoverable." : "Add Vercel config, project link, or deploy instructions.",
    ),
    check(
      "do_not_break",
      "Do-not-break notes",
      input.hasDoNotBreakNotes,
      input.hasDoNotBreakNotes ? "Risk notes are available." : "Add the flows or constraints workers must preserve.",
    ),
  ]

  const blocked = checks.filter((item) => item.status === "blocked")
  if (blocked.length) {
    return {
      status: "blocked",
      label: "Blocked",
      tone: "rose",
      summary: `Blocked by ${blocked.map((item) => item.label).join(", ")}.`,
      checks,
    }
  }

  const missing = checks.filter((item) => item.status === "missing")
  if (missing.length) {
    return {
      status: "missing_setup",
      label: "Missing setup",
      tone: "amber",
      summary: `Missing ${missing.map((item) => item.label.toLowerCase()).join(", ")}.`,
      checks,
    }
  }

  return {
    status: "ready",
    label: "Ready",
    tone: "emerald",
    summary: "Project has the operating contract needed for a worker run.",
    checks,
  }
}

async function fileExists(filePath: string) {
  return fs.access(filePath).then(
    () => true,
    () => false,
  )
}

async function readJson(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8").catch(() => "")
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

async function fileIncludes(projectDir: string, filename: string, patterns: RegExp[]) {
  const content = await fs.readFile(path.join(projectDir, filename), "utf8").catch(() => "")
  return patterns.some((pattern) => pattern.test(content))
}

export async function readProjectReadiness(
  projectDir: string,
  projectStatus?: Pick<ProjectStatus, "deploymentLinks" | "investigation"> | null,
): Promise<ProjectReadiness> {
  const packageJson = await readJson(path.join(projectDir, "package.json"))
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts as Record<string, unknown> : {}
  const hasPackageTest = typeof scripts.test === "string" && scripts.test.trim().length > 0
  const hasPackageBuild = typeof scripts.build === "string" && scripts.build.trim().length > 0
  const hasProductLink = Boolean(
    projectStatus?.deploymentLinks?.production?.url ||
      projectStatus?.deploymentLinks?.stage?.url ||
      projectStatus?.investigation?.deploymentDetails?.url,
  )

  const [repoExists, tasks, handoff, qa, security, envExample, vercelJson, linkedVercel, deployDocs, qaHasContent, securityHasContent] =
    await Promise.all([
      fileExists(projectDir),
      fileExists(path.join(projectDir, "TASKS.md")),
      fileExists(path.join(projectDir, "HANDOFF.md")),
      fileExists(path.join(projectDir, "QA_CHECKLIST.md")),
      fileExists(path.join(projectDir, "SECURITY_CHECKLIST.md")),
      fileExists(path.join(projectDir, ".env.example")),
      fileExists(path.join(projectDir, "vercel.json")),
      fileExists(path.join(projectDir, ".vercel", "project.json")),
      fileIncludes(projectDir, "HANDOFF.md", [/deploy/i, /vercel/i]),
      fileIncludes(projectDir, "QA_CHECKLIST.md", [/\S/]),
      fileIncludes(projectDir, "SECURITY_CHECKLIST.md", [/do not break/i, /preserve/i, /risk/i, /\S/]),
    ])

  return deriveProjectReadiness({
    repoExists,
    governanceFiles: { tasks, handoff, qa, security },
    hasEnvContract: envExample || security,
    hasProductLink,
    hasTestCommand: hasPackageTest || qaHasContent,
    hasDeployPath: hasPackageBuild || vercelJson || linkedVercel || deployDocs || hasProductLink,
    hasDoNotBreakNotes: qaHasContent || securityHasContent,
  })
}
