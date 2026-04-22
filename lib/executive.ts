import type { ProjectRuntimeState } from "@/lib/orchestration"

function normalizeText(text: string) {
  return text
    .replace(/^- \[[ xX]\]\s*/gm, "")
    .replace(/^\[[ xX]\]\s*/gm, "")
    .replace(/\[INFERRED\]\s*/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/tokens used[\s\S]*/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

function firstSentence(text: string) {
  const cleaned = normalizeText(text)
  const match = cleaned.match(/(.+?[.!?])(\s|$)/)
  return match?.[1]?.trim() ?? cleaned
}

export function executiveizeText(text: string, fallback = "No summary recorded yet.") {
  const cleaned = normalizeText(text)
  if (/^(none|none\.)$/i.test(cleaned)) {
    return fallback
  }
  return cleaned || fallback
}

export function executiveStatusLabel(status: string) {
  if (status === "awaiting_ceo") return "Needs your decision"
  if (status === "blocked_on_config") return "Blocked on config"
  if (status === "blocked") return "Blocked"
  if (status === "healthy") return "On track"
  if (status === "stale_governance") return "Needs record refresh"
  if (status === "cancelled") return "Paused"
  if (status === "completed") return "Completed"
  if (status === "running") return "In progress"
  if (status === "queued") return "Queued"
  if (status === "failed") return "Needs recovery"
  if (status === "timed_out") return "Timed out"
  if (status === "build") return "Build"
  if (status === "qa") return "QA"
  if (status === "ship") return "Ready to ship"
  return executiveizeText(status, "Status update")
}

export function executiveizeTaskItem(text: string) {
  const normalized = normalizeText(text)
  if (/^none(\.|$)/i.test(normalized)) {
    return "No current assignment is recorded."
  }
  const cleaned = executiveizeText(text, "No work item recorded.")

  if (/service-role|supabase|env parity|digest/i.test(cleaned)) {
    return "Restore production data visibility and confirm the operating setup is aligned."
  }

  if (/auth callback|oauth|sign-in path|onboarding/i.test(cleaned)) {
    return "Finish the main sign-in path and confirm the user onboarding flow."
  }

  if (/productize auth|single-user|authentication/i.test(cleaned)) {
    return "Decide the rollout path for access control before broadening the audience."
  }

  if (/queue-driven execution|externalize local paths|machine-specific|path portability/i.test(cleaned)) {
    return "Choose the primary workflow path and remove setup that only works on one machine."
  }

  if (/mixed task|scope split|entrypoint decision|two execution paths|run_days\.py|pipeline\/run\.py/i.test(cleaned)) {
    return "Choose the primary workflow path before sending the next build assignment."
  }

  if (/qa and security checklist|full qa|security checklist/i.test(cleaned)) {
    return "Run the release checks once the next focused build task is complete."
  }

  if (/escalation|scope-clarification/i.test(cleaned)) {
    return "Resolve the open decision before sending more build work."
  }

  return firstSentence(cleaned)
}

export function executiveizeError(description: string, impact?: string) {
  const cleanedDescription = executiveizeText(description, "")
  const cleanedImpact = executiveizeText(impact ?? "", "")
  const combined = [cleanedDescription, cleanedImpact].filter(Boolean).join(" ")

  if (!combined) {
    return {
      description: "No active risk is currently recorded.",
      impact: "",
    }
  }

  if (/service-role|supabase|env/i.test(combined)) {
    return {
      description: "Production data access is at risk until configuration is aligned.",
      impact: "This can limit visibility into live project output.",
    }
  }

  if (/oauth|callback|auth|email/i.test(combined)) {
    return {
      description: "The sign-in experience is not fully dependable yet.",
      impact: "Rollout is constrained until access is consistent.",
    }
  }

  if (/path portability|machine-specific|hardcoded local paths|hardcodes raw_dir|absolute path|single absolute path/i.test(combined)) {
    return {
      description: "This workflow still depends on one-machine setup.",
      impact: "It is not ready for smooth handoff or broader execution.",
    }
  }

  return {
    description: firstSentence(cleanedDescription || combined),
    impact: firstSentence(cleanedImpact),
  }
}

export function executiveizeLatestOutcome(text: string) {
  const cleaned = executiveizeText(text, "")

  if (!cleaned) {
    return "No recent outcome summary is available yet."
  }

  if (/scope split|two execution paths|entrypoint/i.test(cleaned)) {
    return "The system completed its review and surfaced a decision on the primary workflow path."
  }

  if (/worker was cancelled by the operator/i.test(cleaned)) {
    return "The last assignment was paused before completion."
  }

  if (/completed the requested project task/i.test(cleaned)) {
    return "The last assignment completed successfully."
  }

  return firstSentence(cleaned)
}

export function executiveizeBlocker(text: string) {
  const cleaned = executiveizeText(text, "No major blocker recorded.")

  if (/service-role|supabase|env/i.test(cleaned)) {
    return "Production data access depends on a missing or misaligned configuration."
  }

  if (/auth|oauth|callback|email/i.test(cleaned)) {
    return "The sign-in path is not fully settled yet."
  }

  if (/path portability|machine-specific|hardcoded local paths|current machine/i.test(cleaned)) {
    return "The workflow still depends on machine-specific setup."
  }

  if (/anthropic credits depleted|billing depletion/i.test(cleaned)) {
    return "Model access is currently constrained by account limits."
  }

  return cleaned
}

export function executiveizeNextAction(text: string) {
  const cleaned = executiveizeText(text, "Decide the next priority.")

  if (/digest data access|env parity/i.test(cleaned)) {
    return "Restore reliable digest visibility and confirm the production setup is aligned."
  }

  if (/productize auth|local-dev flow/i.test(cleaned)) {
    return "Decide the rollout approach for sign-in and the operating setup."
  }

  if (/auth callback|onboarding/i.test(cleaned)) {
    return "Finish the primary sign-in path and verify the onboarding experience."
  }

  if (/externalize local paths|queue-driven execution/i.test(cleaned)) {
    return "Choose the primary workflow path, then remove machine-specific setup from that path."
  }

  return cleaned
}

export function executiveizeHandoff(text: string) {
  const cleaned = executiveizeText(text)
  return cleaned
    .replace(/Verify by confirming all 10 files exist.*$/i, "The project is now under the shared operating system and is ready for focused execution.")
    .replace(/The repository now has the full governance surface required by the root operating system\./i, "The project is now fully tracked by the operating system.")
    .replace(/The recorded auth-callback blocker was disproven:.*$/i, "The main sign-in path is present, so the earlier blocker no longer appears to be real.")
    .replace(/The evidence for the next move is now clear:?/i, "The system now has a clear recommendation for the next move.")
}

export function executiveDecisionFromPortfolio(projectName: string, reason: string) {
  const cleaned = executiveizeText(reason)

  if (/service-role|supabase/i.test(cleaned)) {
    return {
      projectName,
      title: "Priority decision needed",
      reason: "This project needs a decision on whether restoring production data access is the immediate priority.",
      recommendation: "If this project is mission-critical right now, approve the production-access fix first.",
    }
  }

  if (/single-user|authentication/i.test(cleaned)) {
    return {
      projectName,
      title: "Rollout decision needed",
      reason: "This project needs a decision on whether v1 stays single-user or adds sign-in before broader rollout.",
      recommendation: "Choose the simpler v1 unless broader rollout is urgent.",
    }
  }

  if (/email auth|google oauth/i.test(cleaned)) {
    return {
      projectName,
      title: "Scope decision needed",
      reason: "This project needs a decision on whether email sign-in belongs in v1 or should wait until the main sign-in path is complete.",
      recommendation: "Keep v1 focused on the main sign-in path unless email access is essential for launch.",
    }
  }

  if (/path portability|current machine/i.test(cleaned)) {
    return {
      projectName,
      title: "Release decision needed",
      reason: "This project needs a decision on whether it must work beyond the current machine before broader use.",
      recommendation: "If broader handoff is expected soon, make portability part of the near-term plan.",
    }
  }

  return {
    projectName,
    title: "CEO input requested",
    reason: cleaned,
    recommendation: "Review the project page before approving more work.",
  }
}

export function executiveDecisionFromRuntime(projectName: string, runtimeState: ProjectRuntimeState) {
  const cleaned = executiveizeText(runtimeState.messagePreview || runtimeState.summary, runtimeState.summary)

  if (/scope split|two execution paths|primary flow|entrypoint|pipeline\/run\.py|run_days\.py|queue processing|day-compilation/i.test(cleaned)) {
    return {
      projectName,
      title: "Choose the v1 workflow path",
      reason: "The system paused because RBC currently has two competing workflows, and the next build task is unsafe until one of them is declared the v1 priority.",
      recommendation: "Choose the primary v1 path first, then let the system rewrite the next task around that single path.",
      explanation:
        "The latest review found that `pipeline/run.py` is the queue-first workflow described by the project docs, while `run_days.py` is a separate day-compilation flow that bypasses the queue and still depends on machine-specific paths.",
      evidence: [
        "`PROJECT.md`, `REQUIREMENTS.md`, and `STATE.md` still describe `queue/` plus `pipeline/run.py` as the primary workflow.",
        "`run_days.py` bypasses that queue-first flow and still relies on local-machine paths.",
        "Adjacent portability assumptions still exist in `pipeline/curator.py`, `pipeline/scripts/quality_filter.py`, and `watch_and_sync.sh`.",
      ],
      options: [
        {
          id: "pipeline/run.py",
          label: "Make `pipeline/run.py` the v1 path",
          description: "This keeps v1 aligned with the queue-first workflow already described in the repo docs.",
          impact: "The next worker task will focus on one atomic queue-processing implementation item and treat `run_days.py` as a later follow-on.",
          summary: "This is the more standard operator path: drop source footage into the queue, then let the pipeline process it through the repo’s main documented flow.",
          workflow: [
            "Footage is picked up from the repo’s `queue/` workflow.",
            "Processing stays aligned with the path already described in the project docs.",
            "The next build task can stay narrowly focused on the queue-first flow instead of mixing two systems together.",
          ],
          files: ["pipeline/run.py", "queue/", "PROJECT.md", "REQUIREMENTS.md", "STATE.md"],
          whyThisMatters:
            "This is the path the repo already presents as the main workflow, so choosing it reduces ambiguity and keeps v1 close to the current documented operating model.",
          risk:
            "If the real business priority is day-compilation rather than queue processing, this choice may delay work on the workflow you actually care about most.",
        },
        {
          id: "run_days.py",
          label: "Make `run_days.py` the v1 path",
          description: "This makes the day-compilation flow the priority even though it currently carries the bigger portability burden.",
          impact: "The next worker task will focus on making `run_days.py` and its adjacent dependencies portable before broader use.",
          summary: "This is the day-compilation path: take a day’s media and compile the output flow directly, even though that path currently has more machine-specific assumptions baked into it.",
          workflow: [
            "The workflow centers on `run_days.py` rather than the repo’s queue-first path.",
            "It bypasses the main queue flow and leans on the day-compilation pipeline directly.",
            "The next build task would focus first on portability and adjacent dependencies before broader use.",
          ],
          files: ["run_days.py", "pipeline/curator.py", "pipeline/scripts/quality_filter.py", "watch_and_sync.sh"],
          whyThisMatters:
            "Choose this if day-compilation is the real v1 product, even if it means cleaning up more machine-specific setup before the workflow is dependable.",
          risk:
            "This path has the heavier technical cleanup burden right now, so choosing it likely means more setup and portability work before the system feels stable.",
        },
      ],
      defaultOptionId: "pipeline/run.py",
      priority: "critical" as const,
      source: "runtime" as const,
    }
  }

  if (runtimeState.status === "blocked") {
    return null
  }

  if (runtimeState.status === "stale_governance") {
    return null
  }

  if (runtimeState.status === "cancelled") {
    return null
  }

  if (runtimeState.status === "awaiting_ceo") {
    return {
      projectName,
      title: "Decision needed",
      reason: cleaned,
      recommendation: "Review the recommendation before approving more work.",
      explanation: "The system surfaced a decision point that needs an explicit operator call.",
      evidence: [],
      options: [],
      defaultOptionId: null,
      priority: "important" as const,
      source: "runtime" as const,
    }
  }

  return null
}

export function executiveRuntimeSummary(runtimeState: ProjectRuntimeState) {
  if (runtimeState.status === "awaiting_ceo") {
    return executiveizeText(runtimeState.summary, "The latest run completed and is waiting on your review.")
  }

  if (runtimeState.status === "blocked") {
    return "The system reached a blocker and needs direction before development continues."
  }

  if (runtimeState.status === "cancelled") {
    return "A recent run was cancelled before it finished."
  }

  if (runtimeState.status === "stale_governance") {
    return "The latest work and the project record are not fully aligned yet."
  }

  return executiveizeText(runtimeState.summary, "The latest run completed without a major issue.")
}

export function executiveizeRuntimeMessage(runtimeState: ProjectRuntimeState) {
  const cleaned = executiveizeText(runtimeState.messagePreview || "", "")

  if (!cleaned) {
    return ""
  }

  if (runtimeState.status === "awaiting_ceo") {
    return cleaned
  }

  if (runtimeState.status === "cancelled") {
    return "The last assignment was paused before the project record could be refreshed."
  }

  if (runtimeState.status === "blocked") {
    return "The system identified a blocker and paused implementation until direction is clarified."
  }

  return firstSentence(cleaned)
}
