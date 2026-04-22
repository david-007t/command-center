import { promises as fs } from "fs"
import path from "path"
import { ScoutReport } from "@/components/scout-report"
import { listFeedbackRecords } from "@/lib/feedback"
import { MANAGED_PROJECTS } from "@/lib/managed-projects"
import { getProjectStatus } from "@/lib/project-status"
import { buildDailyScoutBrief } from "@/lib/scout-engine"
import { syncSystemImprovements } from "@/lib/system-improvements"
import { summarizeUsage } from "@/lib/usage-telemetry"

export const dynamic = "force-dynamic"

function parseScoutReport(fileName: string, contents: string) {
  const lines = contents.split("\n")
  const newTools = lines
    .filter((line) => line.startsWith("- ") && line.includes(" — "))
    .slice(0, 3)
    .map((line) => {
      const [name, category, fit] = line.slice(2).split(" — ")
      return { name, category, fit }
    })

  return {
    fileName,
    newTools,
    improvements: [
      {
        file: "_system/templates/CLAUDE.md",
        currentText: "No approved governance improvements applied yet.",
        proposedText: "Replace this entry with approved Scout change text when a CEO approval happens.",
      },
    ],
    revisit: lines
      .filter((line) => line.startsWith("- ") && line.includes(" — "))
      .slice(0, 3)
      .map((line, index) => {
        const [project, revisitCondition] = line.slice(2).split(" — ")
        return {
          project,
          decisionId: `DECISION-${index + 1}`,
          revisitCondition: revisitCondition ?? "Review condition pending",
          status: "Pending review",
        }
      }),
  }
}

export default async function ScoutPage() {
  const developerPath = process.env.DEVELOPER_PATH
  if (!developerPath) {
    return <div className="text-sm text-rose-300">DEVELOPER_PATH is not configured.</div>
  }

  await syncSystemImprovements(developerPath).catch(() => null)

  const reportsDir = path.join(developerPath, "_system", "reports")
  const entries = await fs.readdir(reportsDir).catch(() => [])
  const reportFiles = entries.filter((entry) => /^SCOUT_REPORT_.*\.md$/.test(entry))
  const [projects, feedback, usageSummary] = await Promise.all([
    Promise.all(MANAGED_PROJECTS.map((project) => getProjectStatus(project).catch(() => null))).then((items) =>
      items.filter((item): item is NonNullable<typeof item> => Boolean(item)),
    ),
    listFeedbackRecords(developerPath, 24),
    summarizeUsage(developerPath).catch(() => null),
  ])

  const reports = await Promise.all(
    reportFiles.map(async (fileName) => {
      const contents = await fs.readFile(path.join(reportsDir, fileName), "utf8")
      return parseScoutReport(fileName, contents)
    }),
  )
  const brief = buildDailyScoutBrief({
    projects,
    feedback,
    usageStatus: usageSummary?.guardrails.overallStatus ?? null,
  })

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.4em] text-sky-300">Scout</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Daily scout recommendations</h1>
      </div>
      <ScoutReport reports={reports} brief={brief} />
    </div>
  )
}
