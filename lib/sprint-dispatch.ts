export function chooseProjectRunTemplate(params: {
  instruction: string
  hasPriorityTask: boolean
  runtimeStatus?: string | null
}) {
  const instruction = params.instruction.toLowerCase()

  if (/fix issue|fix this|implement the fix|write code|commit/i.test(instruction)) {
    return "fix_issue"
  }

  if (/qa|quality|security|staging|ship|launch review/.test(instruction)) {
    return "prep_qa"
  }

  if (/investigat|diagnos|debug|why|unverified|trust|preview deploy|vercel/.test(instruction)) {
    return "investigate_issue"
  }

  if (/review|assess|what next|next move|priorit/i.test(instruction)) {
    return "review_next_move"
  }

  if (/blocker|bug|fix|repair|broken|error|issue/.test(instruction)) {
    return "fix_issue"
  }

  if (params.hasPriorityTask) {
    return "continue_project"
  }

  if (params.runtimeStatus === "awaiting_ceo") {
    return "review_next_move"
  }

  if (params.runtimeStatus === "blocked" || params.runtimeStatus === "stale_governance") {
    return "fix_issue"
  }

  return "continue_project"
}
