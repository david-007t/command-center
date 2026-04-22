type RunActivityStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "awaiting_ceo"
  | "blocked"
  | "blocked_on_config"

type RunActivityJob = {
  status: RunActivityStatus
  commentaryPreview?: string | null
  summary?: string | null
}

const activeStatuses = new Set<RunActivityStatus>(["queued", "running"])

export function buildRunActivityView(job?: RunActivityJob | null, runnerAvailable = true) {
  if (!job) {
    return {
      heading: "Agent is idle",
      body: "No active worker is running right now.",
      detail: runnerAvailable ? "The runner is online and ready for the next approved plan." : "The runner is offline, so new work cannot start yet.",
      live: false,
      showPreformatted: false,
    }
  }

  const commentary = job.commentaryPreview?.trim() ?? ""
  const isActive = activeStatuses.has(job.status)

  if (isActive) {
    if (commentary) {
      return {
        heading: "Agent is doing now",
        body: commentary,
        detail: "Live activity from the active worker.",
        live: true,
        showPreformatted: true,
      }
    }

    return {
      heading: "Agent is doing now",
      body:
        job.status === "queued"
          ? runnerAvailable
            ? "Waiting for the worker runner to pick up this assignment."
            : "Waiting because the worker runner is offline."
          : "The worker is active, but it has not reported detailed activity yet.",
      detail: "No tool or text activity has been captured for this run yet.",
      live: true,
      showPreformatted: false,
    }
  }

  if (commentary) {
    return {
      heading: "Last captured agent activity",
      body: commentary,
      detail: `Not live. This run is ${job.status.replaceAll("_", " ")}.`,
      live: false,
      showPreformatted: true,
    }
  }

  return {
    heading: "No live agent activity",
    body: job.summary?.trim() || `This run is ${job.status.replaceAll("_", " ")}.`,
    detail: "No live worker is attached to this run.",
    live: false,
    showPreformatted: false,
  }
}
