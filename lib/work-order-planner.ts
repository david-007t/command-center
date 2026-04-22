export type WorkOrderPriority = "urgent" | "high" | "normal"

export type WorkOrderInput = {
  projectName: string
  goal: string
  context: string
  constraints: string
  acceptanceCriteria: string
  testPlan: string
  priority: WorkOrderPriority
}

export type WorkOrderDraft = Omit<WorkOrderInput, "projectName">

export type WorkOrderStep = {
  title: string
  owner: "Planner" | "SDK worker" | "Verifier" | "CEO"
  outcome: string
}

export type WorkOrderPlan = {
  projectName: string
  title: string
  priority: WorkOrderPriority
  status: "needs_approval"
  requestSummary: string[]
  doNotBreak: string[]
  customPercent: number
  leveragedPercent: number
  customWork: string[]
  leveragedSystems: string[]
  steps: WorkOrderStep[]
  acceptanceCriteria: string[]
  testPlan: string[]
  executionInstruction: string
  executionGate: string
}

export function createBlankWorkOrderDraft(): WorkOrderDraft {
  return {
    goal: "",
    context: "",
    constraints: "",
    acceptanceCriteria: "",
    testPlan: "",
    priority: "high",
  }
}

function splitLines(value: string, fallback: string[]) {
  const lines = value
    .split(/\n|;/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)

  return lines.length ? lines : fallback
}

function firstSentence(value: string, fallback: string) {
  const cleaned = value.trim().replace(/\s+/g, " ")
  if (!cleaned) return fallback
  return cleaned.split(/(?<=[.!?])\s/)[0] ?? cleaned
}

function sentenceFragments(value: string) {
  return value
    .split(/\n|(?<=[.!?])\s+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
}

function includesAny(value: string, terms: string[]) {
  const normalized = value.toLowerCase()
  return terms.some((term) => normalized.includes(term.toLowerCase()))
}

function summarizeRequest(input: WorkOrderInput) {
  const combined = `${input.goal}\n${input.context}`
  const fragments = sentenceFragments(combined)
  const summary: string[] = []

  for (const fragment of fragments) {
    if (
      includesAny(fragment, [
        "three-mode",
        "three mode",
        "Find AI Prospects",
        "Find My Clients",
        "Build a Lead List",
        "Mode 2B",
        "$250",
        "Indeed",
      ])
    ) {
      summary.push(fragment)
    }
  }

  return summary.length ? Array.from(new Set(summary)) : [input.goal.trim() || `Advance ${input.projectName} safely.`]
}

function buildSteps(input: WorkOrderInput, acceptanceCriteria: string[], testPlan: string[]): WorkOrderStep[] {
  const combined = `${input.goal}\n${input.context}\n${input.constraints}\n${input.acceptanceCriteria}\n${input.testPlan}`
  const isLeadQualModeBuild =
    input.projectName.toLowerCase() === "leadqual" &&
    includesAny(combined, ["Build a Lead List", "Mode 2B", "three-mode", "three mode", "Indeed"])

  if (isLeadQualModeBuild) {
    return [
      {
        title: "Freeze the current LeadQual baseline",
        owner: "Planner",
        outcome:
          "Confirm the production link, current Indeed scraping flow, outreach generation, card UI, copy button, pipeline toggle, and export behavior before changes.",
      },
      {
        title: "Scope Mode 2B as the first executable slice",
        owner: "Planner",
        outcome:
          "Convert the request into one worker assignment focused on Build a Lead List first, including city, niche, and result count inputs.",
      },
      {
        title: "Run the approved SDK worker on Mode 2B",
        owner: "SDK worker",
        outcome:
          "Implement the smallest Mode 2B path while preserving the existing Indeed/Find AI Prospects behavior and shared lead card/outreach surfaces.",
      },
      {
        title: "Verify old and new LeadQual flows",
        owner: "Verifier",
        outcome: `Run: ${testPlan.join("; ")}. Confirm acceptance: ${acceptanceCriteria.join("; ")}.`,
      },
      {
        title: "Return LeadQual for CEO test",
        owner: "CEO",
        outcome:
          "Show the latest Vercel product link, what changed in Mode 2B, what still works from the old Indeed flow, what to test, and any remaining gaps.",
      },
    ]
  }

  return [
    {
      title: "Freeze the current product baseline",
      owner: "Planner",
      outcome: "Confirm the latest project status, product link, constraints, and do-not-break list before code changes.",
    },
    {
      title: "Create the smallest executable slice",
      owner: "Planner",
      outcome: "Break the request into one approved worker assignment with clear acceptance criteria.",
    },
    {
      title: "Run the approved SDK worker",
      owner: "SDK worker",
      outcome: "Use the existing agent runner path to implement the approved slice without changing unrelated behavior.",
    },
    {
      title: "Verify and update governance",
      owner: "Verifier",
      outcome: "Run checks, capture the latest Vercel product link, and update handoff/governance files if state changed.",
    },
    {
      title: "Return for CEO test",
      owner: "CEO",
      outcome: "Show a simple status, the test link, what changed, what to test, and anything still open.",
    },
  ]
}

export function buildWorkOrderPlan(input: WorkOrderInput): WorkOrderPlan {
  const goal = firstSentence(input.goal, `Advance ${input.projectName} safely.`)
  const requestSummary = summarizeRequest(input)
  const acceptanceCriteria = splitLines(input.acceptanceCriteria, [
    "The requested behavior is implemented or the blocker is clearly bounded.",
    "Existing working behavior is preserved.",
    "The worker returns a plain-English status, product link, what changed, what to test, and open gaps.",
  ])
  const testPlan = splitLines(input.testPlan, [
    "Run the narrowest relevant automated checks.",
    "Open the latest Vercel product link and verify the user-facing flow.",
    "Update governance files with the result and remaining risk.",
  ])
  const constraints = splitLines(input.constraints, ["Do not break existing working behavior."])
  const steps = buildSteps(input, acceptanceCriteria, testPlan)

  const executionInstruction = [
    `Project: ${input.projectName}`,
    `Goal: ${input.goal.trim() || goal}`,
    input.context.trim() ? `Context:\n${input.context.trim()}` : "",
    `Requested plan summary:\n${requestSummary.map((item) => `- ${item}`).join("\n")}`,
    `Constraints:\n${constraints.map((item) => `- ${item}`).join("\n")}`,
    `Acceptance criteria:\n${acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`,
    `Verification:\n${testPlan.map((item) => `- ${item}`).join("\n")}`,
    `Execution plan:\n${steps.map((step, index) => `${index + 1}. ${step.title}: ${step.outcome}`).join("\n")}`,
    "Return to the CEO only when the task is done, blocked, failed verification, or needs a decision.",
    "Include the latest Vercel product link and a plain-English executive summary.",
  ]
    .filter(Boolean)
    .join("\n\n")

  return {
    projectName: input.projectName,
    title: goal,
    priority: input.priority,
    status: "needs_approval",
    requestSummary,
    doNotBreak: constraints,
    customPercent: 35,
    leveragedPercent: 65,
    customWork: [
      "CEO work-order form and approval gate",
      "Project-specific plan review and send-back loop",
      "Executive output rules: status, product link, what changed, what to test, gaps",
    ],
    leveragedSystems: [
      "Existing Command Center project status and Vercel link lookup",
      "Existing run records and runtime state",
      "Inngest durable execution path for approved runs",
      "Claude Agent SDK worker path for implementation after approval",
      "Supabase runtime/realtime plumbing for live state",
    ],
    steps,
    acceptanceCriteria,
    testPlan,
    executionInstruction,
    executionGate: "Implementation cannot start until this plan is approved.",
  }
}
