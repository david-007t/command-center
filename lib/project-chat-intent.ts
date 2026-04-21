type InvestigationLike = {
  diagnosisCode?: string
  recommendedAction?: {
    kind: string
    summary: string
  }
} | null

export function buildIncidentResponseDirective(userMessage: string, investigation: InvestigationLike) {
  if (!investigation) return ""

  const normalized = userMessage.trim().toLowerCase()
  if (!normalized) return ""

  const incidentPattern = /\b(what happened|what's happening|why|broken|issue|incident|deploy|deployment|stage|preview|vercel|blocker|debug)\b/i
  if (!incidentPattern.test(normalized)) {
    return ""
  }

  return [
    "Answer in incident-response mode.",
    "Lead with the active investigation state instead of a generic project summary.",
    investigation.diagnosisCode ? `Use diagnosis ${investigation.diagnosisCode} explicitly.` : null,
    investigation.recommendedAction ? `If the user asks what to do next, anchor the answer on ${investigation.recommendedAction.kind}.` : null,
    "Prefer the structure: What I checked, What I found, Likely cause, What I'm doing next, Verified vs inferred.",
  ]
    .filter(Boolean)
    .join(" ")
}
