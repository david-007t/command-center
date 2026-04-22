import { Inngest } from "inngest"

export const CONTINUE_PROJECT_EVENT = "command-center/run.continue-project.requested"
export const PROJECT_TASK_EVENT = "command-center/run.project-task.requested"
export const INVESTIGATE_PROJECT_EVENT = "command-center/run.investigate-project.requested"
export const ORCHESTRATOR_RUN_EVENT = "command-center/run.orchestrator.requested"

export const inngest = new Inngest({
  id: "command-center",
  eventKey: process.env.INNGEST_EVENT_KEY || "dev",
  isDev: Boolean(process.env.INNGEST_DEV) || process.env.NODE_ENV !== "production",
})
