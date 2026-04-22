import type { WorkOrderDraft, WorkOrderPriority } from "./work-order-planner"

export type FeedbackWorkOrderInput = {
  projectName: string
  feedback: string
  expectedBehavior?: string
  productUrl?: string | null
  priority?: WorkOrderPriority
}

function clean(value?: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

export function buildFeedbackWorkOrderDraft(input: FeedbackWorkOrderInput): WorkOrderDraft {
  const feedback = clean(input.feedback)
  const expectedBehavior = clean(input.expectedBehavior)
  const productUrl = clean(input.productUrl)
  const priority = input.priority ?? "high"
  const projectName = input.projectName

  return {
    goal: feedback
      ? `Fix the ${projectName} issue reported during CEO testing: ${feedback}`
      : `Fix the ${projectName} issue reported during CEO testing.`,
    context: [
      "CEO test feedback:",
      feedback || "No detailed feedback was provided.",
      expectedBehavior ? `Expected behavior: ${expectedBehavior}` : "",
      productUrl ? `Product link tested: ${productUrl}` : "",
      "Treat this as a feedback-to-fix run: inspect the current product behavior, find the narrowest code change, and preserve unrelated working flows.",
    ]
      .filter(Boolean)
      .join("\n"),
    constraints: [
      "Do not break existing working behavior.",
      "Keep the current deployment path intact.",
      "Keep the fix scoped to the reported feedback unless a directly related blocker is found.",
      "Return with a plain-English status, product link, what changed, what to test, and any remaining gaps.",
    ].join("\n"),
    acceptanceCriteria: [
      "The reported issue is fixed or clearly bounded with the exact reason it cannot be fixed yet.",
      "The user-facing error or status explains what happened in plain English.",
      "Existing core flows still work.",
      "The worker returns the latest product link and a focused CEO test checklist.",
    ].join("\n"),
    testPlan: [
      "Reproduce the reported issue before changing code when possible.",
      "Run the narrowest relevant automated checks.",
      "Open the latest product link and retest the exact feedback scenario.",
      "Verify the adjacent existing flow still works.",
    ].join("\n"),
    priority,
  }
}
