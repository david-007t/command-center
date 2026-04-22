import { promises as fs } from "fs"
import { deriveInvestigationAutonomy } from "@/lib/command-center-guardrails"
import { getProjectFilePath } from "@/lib/managed-projects"
import { ensureProjectContextPack } from "@/lib/project-context-pack"
import { getProjectStatus } from "@/lib/project-status"
import { readProjectPageDataFromStore } from "@/lib/runtime-store/phase1-store"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { syncSystemImprovements } from "@/lib/system-improvements"
import { summarizeUsage } from "@/lib/usage-telemetry"
import { isLocalWorkerRunnerAvailable } from "@/lib/dev-runner-health"

const FILES = [
  { label: "Overview", file: "SPEC.md" },
  { label: "Tasks", file: "TASKS.md" },
  { label: "Last Handoff", file: "HANDOFF.md" },
  { label: "Errors", file: "ERRORS.md" },
  { label: "Decisions", file: "DECISIONS.md" },
  { label: "Improvements", file: "SYSTEM_IMPROVEMENTS.md" },
  { label: "QA", file: "QA_CHECKLIST.md" },
  { label: "Security", file: "SECURITY_CHECKLIST.md" },
]

export async function loadProjectPageData(projectName: string) {
  const developerPath = process.env.DEVELOPER_PATH
  if (!developerPath) {
    throw new Error("DEVELOPER_PATH is not configured.")
  }

  if (isSupabaseConfigured()) {
    const stored = await readProjectPageDataFromStore(projectName, developerPath)
    if (stored?.projectStatus) {
      const tabs: Record<string, string> = {}
      for (const item of FILES) {
        const filePath = getProjectFilePath(developerPath, projectName, item.file)
        tabs[item.label] = await fs.readFile(filePath, "utf8").catch(() => `${item.file} is not available in the cloud runtime.`)
      }

      return {
        projectStatus: stored.projectStatus,
        contextPack: stored.contextPack,
        usageSummary: stored.usageSummary,
        runnerAvailable: await isLocalWorkerRunnerAvailable(),
        tabs,
      }
    }
  }

  await syncSystemImprovements(developerPath).catch(() => null)
  await fs.access(getProjectFilePath(developerPath, projectName, "TASKS.md"))

  const tabs: Record<string, string> = {}
  for (const item of FILES) {
    const filePath = getProjectFilePath(developerPath, projectName, item.file)
    tabs[item.label] = await fs.readFile(filePath, "utf8").catch(() => `${item.file} not found.`)
  }

  const [projectStatus, contextPack, usageSummary, runnerAvailable] = await Promise.all([
    getProjectStatus(projectName),
    ensureProjectContextPack(developerPath, projectName),
    summarizeUsage(developerPath),
    isLocalWorkerRunnerAvailable(),
  ])

  const autonomy = projectStatus.investigation
    ? deriveInvestigationAutonomy({
        canAutofix: projectStatus.investigation.canAutofix,
        contextHealth: contextPack.health,
        usageStatus: usageSummary.guardrails.overallStatus,
      })
    : null

  return {
    projectStatus: projectStatus.investigation
      ? {
          ...projectStatus,
          investigation: {
            ...projectStatus.investigation,
            autonomyMode: autonomy?.mode,
            autonomyRationale: autonomy?.rationale,
          },
        }
      : projectStatus,
    contextPack,
    usageSummary,
    runnerAvailable,
    tabs,
  }
}
