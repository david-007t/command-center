import { promises as fs } from "fs"
import path from "path"
import { COMMAND_CENTER_PROJECT, resolveProjectDir } from "./managed-projects"
import { listFeedbackRecords, type FeedbackRecord } from "./feedback"
import { buildSystemImprovementsMarkdown } from "./system-improvements-markdown"

export function getSystemImprovementsPath(developerPath: string) {
  return path.join(resolveProjectDir(developerPath, COMMAND_CENTER_PROJECT), "SYSTEM_IMPROVEMENTS.md")
}

export async function syncSystemImprovements(developerPath: string, records?: FeedbackRecord[]) {
  const all = records ?? (await listFeedbackRecords(developerPath, 100))
  const relevant = all.filter((record) => record.scope === "system" || record.projectName === COMMAND_CENTER_PROJECT)
  const filePath = getSystemImprovementsPath(developerPath)
  await fs.writeFile(filePath, buildSystemImprovementsMarkdown(relevant), "utf8")
  return filePath
}
