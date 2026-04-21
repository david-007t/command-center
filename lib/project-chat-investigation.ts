export type ProjectChatInvestigation = {
  title: string
  summary: string
  likelyCause: string
  nextStep: string
  diagnosisCode?: string
  recommendedAction?: {
    kind: string
    summary: string
  }
  proofSummary?: {
    verified: string[]
    inferred: string[]
    blocked: string[]
  }
  deploymentDetails?: {
    branch: string
    state: string
    commitSha: string | null
    url: string | null
    createdAt: string | null
  }
}

export function buildProjectInvestigationBrief(investigation: ProjectChatInvestigation | null | undefined) {
  if (!investigation) return "No active investigation snapshot."

  const lines = [
    `Investigation: ${investigation.title}`,
    `Summary: ${investigation.summary}`,
    `Likely cause: ${investigation.likelyCause}`,
    `Exact next fix: ${investigation.nextStep}`,
  ]

  if (investigation.diagnosisCode) {
    lines.push(`Diagnosis: ${investigation.diagnosisCode}`)
  }

  if (investigation.recommendedAction) {
    lines.push(`Recommended remediation: ${investigation.recommendedAction.kind}`)
    lines.push(`Remediation summary: ${investigation.recommendedAction.summary}`)
  }

  if (investigation.proofSummary?.verified?.length) {
    lines.push("Verified proof:")
    lines.push(...investigation.proofSummary.verified.map((item) => `- ${item}`))
  }

  if (investigation.proofSummary?.inferred?.length) {
    lines.push("Inferred:")
    lines.push(...investigation.proofSummary.inferred.map((item) => `- ${item}`))
  }

  if (investigation.proofSummary?.blocked?.length) {
    lines.push("Blocked evidence:")
    lines.push(...investigation.proofSummary.blocked.map((item) => `- ${item}`))
  }

  if (investigation.deploymentDetails) {
    lines.push("Latest deployment snapshot:")
    lines.push(`- Branch: ${investigation.deploymentDetails.branch}`)
    lines.push(`- State: ${investigation.deploymentDetails.state}`)
    lines.push(`- Commit: ${investigation.deploymentDetails.commitSha || "unknown"}`)
    lines.push(`- Created: ${investigation.deploymentDetails.createdAt || "unknown"}`)
    if (investigation.deploymentDetails.url) {
      lines.push(`- URL: ${investigation.deploymentDetails.url}`)
    }
  }

  return lines.join("\n")
}

export function buildProjectInvestigationOpeningMessage(projectName: string, investigation: ProjectChatInvestigation | null | undefined) {
  if (!investigation) {
    return `${projectName} loaded. This chat is in stabilization mode: ask for status, blocker, decision, why a job is queued, or say proceed to launch the recommended local action.`
  }

  const lines = [
    `${projectName} loaded with an active investigation.`,
    "",
    "**What I checked**",
    investigation.proofSummary?.verified?.length
      ? investigation.proofSummary.verified.join(" ")
      : "The latest investigation snapshot, runtime state, and deployment context.",
    "",
    "**What I found**",
    investigation.summary,
    "",
    "**Likely cause**",
    investigation.likelyCause,
    "",
    "**What I'm doing next**",
    investigation.recommendedAction
      ? `${investigation.recommendedAction.kind}: ${investigation.recommendedAction.summary}`
      : investigation.nextStep,
    "",
    "**Verified vs inferred**",
    [
      investigation.proofSummary?.verified?.length ? `Verified: ${investigation.proofSummary.verified.join(" ")}` : null,
      investigation.proofSummary?.inferred?.length ? `Inferred: ${investigation.proofSummary.inferred.join(" ")}` : null,
      investigation.proofSummary?.blocked?.length ? `Blocked: ${investigation.proofSummary.blocked.join(" ")}` : null,
    ]
      .filter(Boolean)
      .join(" "),
  ]

  if (investigation.deploymentDetails) {
    lines.push("")
    lines.push(
      `Latest deployment snapshot: ${investigation.deploymentDetails.branch} is ${investigation.deploymentDetails.state}${
        investigation.deploymentDetails.commitSha ? ` at ${investigation.deploymentDetails.commitSha}` : ""
      }.`,
    )
  }

  return lines.join("\n")
}
