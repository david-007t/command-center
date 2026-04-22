type RunBriefJob = {
  projectName: string | null
  status: string
  statusLabel: string
  summary: string
  messagePreview: string
  rawMessagePreview?: string
  executiveMessage: string
  currentStage: string
}

type RunBriefContext = {
  projectName: string
  productUrl?: string | null
  productLinks?: Array<{
    label: string
    url: string
    environment: "production" | "stage"
    source: string
    state: string
    createdAt: string | null
  }>
  qaChecklist?: string
  securityChecklist?: string
}

type ProductLink = {
  label: string
  href: string
  note: string
}

export type RunCeoBrief = {
  status: string
  productLinks: ProductLink[]
  bottomLine: string
  whatChanged: string[]
  whatToTest: string[]
  knownGaps: string[]
}

function stripMarkdown(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function sourceText(job: RunBriefJob) {
  return [job.rawMessagePreview, job.messagePreview, job.executiveMessage, job.summary].filter(Boolean).join("\n\n").trim()
}

function normalizeSectionHeadings(markdown: string) {
  return markdown
    .replace(/\s*---\s*/g, "\n")
    .replace(/([^\n])\s+(#{1,4}\s+)/g, "$1\n$2")
}

function extractSection(markdown: string, title: string) {
  const normalized = normalizeSectionHeadings(markdown)
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const headingPattern = new RegExp(`^#{1,4}\\s+${escapedTitle}\\b\\s*(.*)$`, "i")
  const lines = normalized.split("\n")
  const startIndex = lines.findIndex((line) => headingPattern.test(line.trim()))
  if (startIndex === -1) return ""

  const firstLine = lines[startIndex]?.trim().match(headingPattern)?.[1] ?? ""
  const body = [firstLine]

  for (const line of lines.slice(startIndex + 1)) {
    if (/^#{1,4}\s+\S/.test(line.trim())) break
    body.push(line)
  }

  return body.join("\n").trim()
}

function markdownList(section: string) {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => stripMarkdown(line.replace(/^- /, "")))
    .filter(Boolean)
}

function tableRows(section: string) {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !/^\|\s*-+\s*\|/.test(line))
    .map((line) =>
      line
        .split("|")
        .map((cell) => stripMarkdown(cell))
        .filter(Boolean),
    )
    .filter((cells) => cells.length >= 2 && !/^file$/i.test(cells[0] ?? ""))
    .map((cells) => `${cells[0]}: ${cells.slice(1).join(" ")}`)
}

function paragraphItems(section: string) {
  const list = markdownList(section)
  if (list.length) return list

  const table = tableRows(section)
  if (table.length) return table

  const paragraph = stripMarkdown(section)
  return paragraph ? [paragraph] : []
}

function firstSectionItems(markdown: string, titles: string[]) {
  for (const title of titles) {
    const items = paragraphItems(extractSection(markdown, title))
    if (items.length) return items
  }

  return []
}

function fallbackChangedItems(text: string, job: RunBriefJob) {
  const outcome = paragraphItems(extractSection(text, "Outcome"))
  if (outcome.length) return outcome

  const summary = stripMarkdown(job.executiveMessage || job.summary)
  return summary ? [summary] : ["No worker summary was captured."]
}

function buildProductLinks(context: RunBriefContext): ProductLink[] {
  if (context.productLinks?.length) {
    return context.productLinks.map((link) => ({
      label: link.environment === "production" ? "Open production" : "Open stage",
      href: link.url,
      note: `${link.label} deployment from ${link.source}${link.state ? ` (${link.state})` : ""}.`,
    }))
  }

  if (context.productUrl) {
    return [
      {
        label: "Open product",
        href: context.productUrl,
        note: "This is the latest product URL captured by Command Center.",
      },
    ]
  }

  return [
    {
      label: "Local Vercel dev",
      href: "http://localhost:3000",
      note: `No Vercel deployment URL is available yet. Start ${context.projectName} with vercel dev, then open this local link.`,
    },
  ]
}

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)))
}

function executiveChangedItems(text: string, fallbackItems: string[]) {
  const explicitItems = fallbackItems.filter((item) => !/^[^:]+:\s/.test(item))
  if (explicitItems.length) return unique(explicitItems.map((item) => stripMarkdown(item))).slice(0, 3)

  const lower = text.toLowerCase()
  const items = [] as string[]

  if (lower.includes("api/send-email") || lower.includes("smtp")) {
    items.push("The worker hardened the email-sending backend so SMTP credentials stay on the server.")
  }

  if (lower.includes(".env.example")) {
    items.push("It documented the environment variables the app needs to run.")
  }

  if (lower.includes("security_checklist")) {
    items.push("It updated the security checklist to reflect the email security fix.")
  }

  if (lower.includes("tasks.md")) {
    items.push("It marked that backend email-security task as done.")
  }

  return unique(items.length ? items : fallbackItems.map((item) => stripMarkdown(item))).slice(0, 3)
}

function executiveTestItems(text: string, fallbackItems: string[]) {
  const lower = text.toLowerCase()

  if (lower.includes("vercel dev") || lower.includes("lead-generation happy path")) {
    return [
      "Open the product and run the normal lead-generation flow.",
      "Check that saving, editing, deleting, and refreshing a Ship List company still works.",
    ]
  }

  if (fallbackItems.length && !fallbackItems.some((item) => /no explicit test step/i.test(item))) {
    return unique(fallbackItems.map((item) => stripMarkdown(item))).slice(0, 3)
  }

  return unique(fallbackItems.map((item) => stripMarkdown(item))).slice(0, 2)
}

function executiveKnownGaps(text: string, qaChecklist?: string, securityChecklist?: string) {
  const gaps = [] as string[]

  if (/no frontend caller/i.test(text)) {
    gaps.push("The email backend fix may not have a visible button or screen to test yet.")
  }

  if (hasFailingGate(qaChecklist)) {
    gaps.push("QA is still not signed off because the real product flow has not been tested and recorded.")
  }

  if (hasFailingGate(securityChecklist)) {
    gaps.push("Security is improved, but the full security checklist is still not complete.")
  }

  return gaps
}

function bottomLineFor(text: string, status: string, decisionItems: string[]) {
  const lower = text.toLowerCase()

  if (status === "cancelled") {
    return "Cancelled before completion. No verified product changes came out of this run."
  }

  if (status === "awaiting_ceo" && decisionItems.length) {
    return decisionItems[0]
  }

  if (status === "awaiting_ceo") {
    return "Decision needed: run the listed test steps, then sign off or send it back with feedback."
  }

  if (status === "completed" && (lower.includes("api/send-email") || lower.includes("smtp"))) {
    return "The worker fixed a backend email-security issue. This was real work, but it does not prove the whole Leadqual product is ready yet."
  }

  if (status === "completed") {
    return "The worker finished its assignment. Review the test step before treating the project as ready."
  }

  if (status === "timed_out") {
    return "This run did not actually start. Retry it after confirming the worker runner is connected."
  }

  if (status === "blocked" || status === "failed") {
    return "The worker stopped before finishing and needs attention before you test product readiness."
  }

  return "The worker finished with a decision or follow-up still needed before signoff."
}

function hasFailingGate(markdown?: string) {
  return Boolean(markdown && /result:\s*fail/i.test(markdown))
}

export function buildRunCeoBrief(job: RunBriefJob, context: RunBriefContext): RunCeoBrief {
  const text = sourceText(job)
  const structuredText = job.rawMessagePreview || job.messagePreview || text
  const changesItems = firstSectionItems(structuredText, ["What changed", "Changes made"])
  const testItems = firstSectionItems(structuredText, ["What to test", "Next step", "Verification"])
  const decisionItems = firstSectionItems(structuredText, ["CEO decision needed", "Decision needed", "Needs your decision"])
  const openItems = firstSectionItems(structuredText, ["Still open", "Open gaps", "Known gaps", "Gaps"])
  const knownGaps = executiveKnownGaps(text, context.qaChecklist, context.securityChecklist)

  if (job.status === "cancelled") {
    return {
      status: job.statusLabel,
      productLinks: buildProductLinks(context),
      bottomLine: bottomLineFor(text, job.status, decisionItems),
      whatChanged: ["No verified product or code change came out of this cancelled run."],
      whatToTest: ["Nothing new needs CEO testing from this cancelled run."],
      knownGaps: ["Continue or retry the approved plan if the fix is still needed."],
    }
  }

  for (const item of [...decisionItems, ...openItems]) {
    knownGaps.push(item)
  }

  if (!knownGaps.length && job.status !== "completed") {
    const fallbackGap = stripMarkdown(job.executiveMessage || job.summary)
    if (fallbackGap) knownGaps.push(fallbackGap)
  }

  return {
    status: job.statusLabel,
    productLinks: buildProductLinks(context),
    bottomLine: bottomLineFor(text, job.status, decisionItems),
    whatChanged: executiveChangedItems(text, changesItems.length ? changesItems : fallbackChangedItems(text, job)),
    whatToTest: executiveTestItems(
      text,
      testItems.length ? testItems : ["No explicit test step was captured by the worker."],
    ),
    knownGaps: unique(knownGaps),
  }
}
