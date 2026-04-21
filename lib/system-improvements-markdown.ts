export type ImprovementRecord = {
  id: string
  createdAt: string
  scope: "system" | "project"
  projectName: string | null
  category: "self_heal" | "product_improvement" | "governance_fix" | "needs_decision"
  severity: "low" | "medium" | "high"
  summary: string
  desiredOutcome: string
  status: "logged" | "actioning" | "resolved" | "needs_decision"
  source: "chat"
  relatedJobId: string | null
  resolutionNote: string | null
}

function itemLine(record: ImprovementRecord) {
  const status = record.status === "actioning" ? "In progress" : record.status === "resolved" ? "Resolved" : record.status === "needs_decision" ? "Needs decision" : "Logged"
  const outcome = record.resolutionNote ? ` Outcome: ${record.resolutionNote}` : ""
  return `- ${record.createdAt.slice(0, 10)} — [${status}] ${record.summary}. Desired outcome: ${record.desiredOutcome}.${outcome}`
}

export function buildSystemImprovementsMarkdown(records: ImprovementRecord[]) {
  const open = records.filter((record) => record.status === "logged" || record.status === "actioning" || record.status === "needs_decision")
  const resolved = records.filter((record) => record.status === "resolved")
  const active = open[0]

  return [
    "# SYSTEM_IMPROVEMENTS.md",
    `# Last updated: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "## Current improvement focus",
    "",
    active
      ? `Command Center is currently tracking ${active.category.replaceAll("_", " ")} work: ${active.summary}.`
      : "No active Command Center self-improvement item is currently in flight.",
    "",
    "## Open items",
    "",
    ...(open.length ? open.map(itemLine) : ["- No open self-heal or system-improvement item is currently queued."]),
    "",
    "## Recently resolved",
    "",
    ...(resolved.length ? resolved.slice(0, 8).map(itemLine) : ["- No resolved system-improvement item has been recorded yet."]),
    "",
    "## Tracking notes",
    "",
    "- Scope includes system feedback and any feedback explicitly attached to `command-center`.",
    "- This ledger is generated from runtime feedback records so self-heal work stays visible in project governance.",
    "- Use this file to understand what the operating system is trying to improve for itself, not as the source of implementation truth.",
    "",
  ].join("\n")
}
