import { promises as fs } from "fs"
import path from "path"
import { promisify } from "util"
import { execFile } from "child_process"

import { inngest, PROJECT_TASK_EVENT } from "../client"
import {
  assertEvidenceBeforeDone,
  createRunArtifact,
  listRunArtifacts,
  readInngestManagedRun,
  touchRunHeartbeat,
  updateRunRecord,
  upsertTrackedStep,
} from "@/lib/inngest-run-store"
import { recordProjectRuntimeUpdated, recordRuntimeEvent } from "@/lib/runtime-events"
import { buildRuntimeStateFromFinalJob, classifyWorkerOutcome } from "@/lib/worker-outcome"
import { writeProjectRuntimeState, type ProjectRunTemplate, type RuntimeJob } from "@/lib/orchestration"
import { runWorkerAgent } from "@/lib/agent-runner"
import { ManagedRunCancelledError, throwIfCancellationRequested } from "./cancellation"
import { buildProjectTaskPrompt } from "./project-task-prompt"

const execFileAsync = promisify(execFile)
const MAX_ARTIFACT_CHARS = 120_000

function truncateArtifact(value: string, label: string) {
  if (value.length <= MAX_ARTIFACT_CHARS) return value
  return `${value.slice(0, MAX_ARTIFACT_CHARS)}\n\n[${label} truncated at ${MAX_ARTIFACT_CHARS.toLocaleString()} characters for runtime storage. Full detail remains in the worker/provider logs when available.]`
}

type SupportedProjectTaskTemplate = Exclude<ProjectRunTemplate, "continue_project" | "investigate_issue">

async function safeGit(projectDir: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectDir, ...args])
    return stdout.trim()
  } catch {
    return ""
  }
}

async function transitionRunStage(params: {
  runId: string
  projectName: string
  runTemplate: SupportedProjectTaskTemplate
  chatThreadId?: string | null
  status: RuntimeJob["status"]
  currentStage: RuntimeJob["currentStage"]
  summary: string
}) {
  await throwIfCancellationRequested(params.runId)
  const now = new Date().toISOString()
  const updated = await updateRunRecord(params.runId, {
    status: params.status,
    current_stage: params.currentStage,
    summary: params.summary,
    started_at: params.status === "running" ? now : undefined,
    metadata: {
      stageUpdatedAt: now,
      lastHeartbeatAt: now,
    },
  })

  await recordRuntimeEvent({
    eventType: "run_stage_changed",
    title: `${params.projectName} - ${params.currentStage.replaceAll("_", " ")} in progress`,
    body: params.summary,
    projectName: params.projectName,
    chatThreadId: params.chatThreadId ?? null,
    reason: "job_update",
    job: {
      id: updated.id,
      projectName: params.projectName,
      chatThreadId: params.chatThreadId ?? null,
      runTemplate: params.runTemplate,
      instruction: updated.instruction,
      status: updated.status,
      currentStage: updated.current_stage,
      summary: updated.summary ?? params.summary,
      createdAt: updated.created_at,
      startedAt: updated.started_at,
      completedAt: updated.completed_at,
    },
  }).catch(() => null)

  return updated
}

export const projectTaskFunction = inngest.createFunction(
  {
    id: "command-center-project-task",
    retries: 2,
    triggers: { event: PROJECT_TASK_EVENT },
  },
  async ({ event, step }) => {
    const runId = String(event.data.runId)
    const run = await step.run("load-run", async () => {
      const current = await readInngestManagedRun(runId)
      if (!current) {
        throw new Error(`Inngest-managed run ${runId} was not found.`)
      }
      return current
    })
    await throwIfCancellationRequested(runId)

    const metadata = (run.metadata ?? {}) as Record<string, unknown>
    const projectName = String(metadata.projectName ?? "")
    const chatThreadId = typeof metadata.chatThreadId === "string" ? metadata.chatThreadId : null
    const workingDirectory = String(metadata.workingDirectory ?? "")
    const successCriteria = Array.isArray(metadata.successCriteria) ? (metadata.successCriteria as string[]) : []
    const governanceTargets = Array.isArray(metadata.governanceTargets) ? (metadata.governanceTargets as string[]) : []
    const rawRunTemplate = String(run.run_template ?? "custom")
    if (rawRunTemplate === "continue_project" || rawRunTemplate === "investigate_issue") {
      throw new Error(`Unsupported project-task template for generic Inngest worker: ${rawRunTemplate}`)
    }
    const runTemplate = rawRunTemplate as SupportedProjectTaskTemplate

    const tracked = async <T>(stepKey: string, stage: RuntimeJob["currentStage"], work: () => Promise<T>) => {
      await throwIfCancellationRequested(runId)
      const startedAt = new Date().toISOString()
      await upsertTrackedStep({
        runId,
        stepKey,
        stepType: stage,
        status: "running",
        startedAt,
        input: {
          projectName,
          stage,
          runTemplate,
        },
      })

      await transitionRunStage({
        runId,
        projectName,
        runTemplate,
        chatThreadId,
        status: "running",
        currentStage: stage,
        summary:
          stage === "reading_context"
            ? "Reading project context."
            : stage === "planning"
              ? "Planning the assignment."
              : stage === "executing"
                ? "Executing the assignment."
                : stage === "verifying"
                  ? "Verifying the result."
                  : "Updating runtime records and governance.",
      })

      try {
        const result = await step.run(stepKey, work)
        await throwIfCancellationRequested(runId)
        await upsertTrackedStep({
          runId,
          stepKey,
          stepType: stage,
          status: "completed",
          startedAt,
          completedAt: new Date().toISOString(),
          output: result && typeof result === "object" ? (result as Record<string, unknown>) : { value: result },
        })
        return result
      } catch (error) {
        await upsertTrackedStep({
          runId,
          stepKey,
          stepType: stage,
          status: error instanceof ManagedRunCancelledError ? "cancelled" : "failed",
          startedAt,
          completedAt: new Date().toISOString(),
          ...(error instanceof ManagedRunCancelledError
            ? {}
            : {
                error: {
                  message: error instanceof Error ? error.message : "Unknown Inngest step error.",
                },
              }),
        })
        throw error
      }
    }
    try {
      const prompt = await tracked("read-context", "reading_context", async () => ({
        prompt: buildProjectTaskPrompt({
          projectName,
          runTemplate,
          instruction: run.instruction,
          governanceTargets,
          successCriteria,
        }),
      }))

      await tracked("plan-assignment", "planning", async () => ({
        instruction: run.instruction,
        governanceTargets,
        successCriteria,
        runTemplate,
      }))

      const execution = await tracked("execute-codex", "executing", async () => {
        const headBefore = await safeGit(workingDirectory, ["rev-parse", "HEAD"])
        const liveActivity: string[] = []
        let lastActivity = ""
        let lastActivityWrite = 0
        const recordActivity = async (line: string) => {
          const cleaned = line.replace(/\s+/g, " ").trim()
          if (!cleaned || cleaned === lastActivity) return
          lastActivity = cleaned
          liveActivity.push(`${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} - ${cleaned}`)
          const now = Date.now()
          if (now - lastActivityWrite < 1500 && !/finished|error|failed/i.test(cleaned)) return
          lastActivityWrite = now
          await touchRunHeartbeat(runId).catch(() => null)
          await createRunArtifact({
            projectName,
            runId,
            artifactType: "commentary",
            label: "Live agent activity",
            content: liveActivity.slice(-20).join("\n"),
            metadata: {
              stage: "executing",
              latestActivityAt: new Date().toISOString(),
            },
          }).catch(() => null)
        }
        await recordActivity("SDK worker started executing the approved assignment.")
        const heartbeat = setInterval(() => {
          void touchRunHeartbeat(runId).catch(() => null)
        }, 30_000)
        const result = await runWorkerAgent({ prompt: prompt.prompt, workingDirectory, runId, onActivity: recordActivity }).finally(() => {
          clearInterval(heartbeat)
        })
        const headAfter = await safeGit(workingDirectory, ["rev-parse", "HEAD"])
        const changedFiles =
          headAfter && headBefore && headAfter !== headBefore
            ? (await safeGit(workingDirectory, ["diff", "--name-only", `${headBefore}..${headAfter}`]))
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
            : []

        return {
          ...result,
          headBefore,
          headAfter,
          changedFiles,
        }
      })

      const verification = await tracked("verify-outcome", "verifying", async () => {
        return classifyWorkerOutcome({
          finalJob: {
            type: "project_task",
            status: execution.exitCode === 0 ? "completed" : "failed",
            runTemplate,
            initialGitHead: execution.headBefore,
          },
          messagePreview: execution.messagePreview,
          headAfter: execution.headAfter,
          changedFiles: execution.changedFiles,
          logPreview: execution.logPreview,
        })
      })

      const evidence = await tracked("write-evidence", "updating_governance", async () => {
        const created = []
        created.push(
          await createRunArtifact({
            projectName,
            runId,
            artifactType: "message_preview",
            label: "Final message",
            content: truncateArtifact(execution.messagePreview, "Final message"),
          }),
        )
        created.push(
          await createRunArtifact({
            projectName,
            runId,
            artifactType: "execution_log",
            label: "Execution log",
            content: truncateArtifact(execution.logPreview, "Execution log"),
          }),
        )
        created.push(
          await createRunArtifact({
            projectName,
            runId,
            artifactType: "verification",
            label: "Verification summary",
            content: `${verification.summary}\n\n${execution.messagePreview}`.trim(),
            metadata: {
              changedFiles: execution.changedFiles,
              runTemplate,
            },
          }),
        )

        return {
          artifactIds: created.map((artifact) => artifact?.id).filter(Boolean),
        }
      })

      const finalized = await tracked("finalize-runtime", "updating_governance", async () => {
        const completedAt = new Date().toISOString()
        const updatedTargets: string[] = []
        for (const target of governanceTargets) {
          const targetPath = path.join(workingDirectory, target)
          const stats = await fs.stat(targetPath).catch(() => null)
          if (stats && run.started_at && stats.mtime.getTime() >= new Date(run.started_at).getTime()) {
            updatedTargets.push(target)
          }
        }
        const missingTargets = governanceTargets.filter((target) => !updatedTargets.includes(target))

        const nextJob: RuntimeJob = {
          id: run.id,
          type: "project_task",
          runTemplate,
          projectName,
          chatThreadId,
          instruction: run.instruction,
          successCriteria,
          governanceTargets,
          status: verification.jobStatus,
          createdAt: run.created_at,
          startedAt: run.started_at,
          completedAt,
          logPath: "",
          messagePath: "",
          commentaryPath: "",
          workingDirectory,
          summary: verification.summary,
          initialGitHead: execution.headBefore,
          configBlocker: verification.configBlocker,
          exitCode: execution.exitCode,
          pid: null,
          currentStage: verification.jobStatus === "completed" || verification.jobStatus === "awaiting_ceo" ? "done" : "blocked",
          stageUpdatedAt: completedAt,
        }

        const runtimeState = buildRuntimeStateFromFinalJob({
          job: nextJob,
          governanceUpdated: missingTargets.length === 0,
          updatedTargets,
          missingTargets,
          messagePreview: execution.messagePreview,
          summary: verification.summary,
        })

        await writeProjectRuntimeState(process.env.DEVELOPER_PATH!, projectName, runtimeState)
        await recordProjectRuntimeUpdated({
          projectName,
          chatThreadId,
          summary: runtimeState.summary,
          reason: verification.jobStatus === "awaiting_ceo" ? "decision" : "job_update",
          job: {
            id: nextJob.id,
            projectName,
            chatThreadId,
            runTemplate: nextJob.runTemplate,
            instruction: nextJob.instruction,
            status: nextJob.status,
            currentStage: nextJob.currentStage,
            summary: runtimeState.summary,
            createdAt: nextJob.createdAt,
            startedAt: nextJob.startedAt,
            completedAt: nextJob.completedAt,
          },
          payload: {
            updatedTargets,
            missingTargets,
            runTemplate,
          },
        }).catch(() => null)
        return {
          completedAt,
          updatedTargets,
          missingTargets,
          runtimeState,
        }
      })

      const artifacts = await listRunArtifacts(runId)
      assertEvidenceBeforeDone({
        run: {
          status: verification.jobStatus === "completed" ? "completed" : verification.jobStatus,
          current_stage: verification.jobStatus === "completed" ? "done" : "blocked",
        },
        artifacts,
      })

      const finalStatus = verification.jobStatus === "completed" || verification.jobStatus === "awaiting_ceo" ? verification.jobStatus : "blocked"
      const finalStage = verification.jobStatus === "completed" || verification.jobStatus === "awaiting_ceo" ? "done" : "blocked"
      const finalRun = await updateRunRecord(runId, {
        status: finalStatus,
        current_stage: finalStage,
        summary: verification.summary,
        completed_at: finalized.completedAt,
        metadata: {
          stageUpdatedAt: finalized.completedAt,
          exitCode: execution.exitCode,
          configBlocker: verification.configBlocker,
          activeProcessPid: null,
        },
      })

      await recordRuntimeEvent({
        eventType:
          finalStatus === "completed"
            ? "run_completed"
            : finalStatus === "awaiting_ceo"
              ? "run_awaiting_ceo"
              : "run_blocked",
        title:
          finalStatus === "completed"
            ? `${projectName} verified outcome`
            : finalStatus === "awaiting_ceo"
              ? `${projectName} needs a decision`
              : `${projectName} blocked outcome`,
        body: execution.messagePreview || verification.summary,
        projectName,
        chatThreadId,
        reason: finalStatus === "awaiting_ceo" ? "decision" : "job_update",
        job: {
          id: finalRun.id,
          projectName,
          chatThreadId,
          runTemplate: finalRun.run_template,
          instruction: finalRun.instruction,
          status: finalRun.status,
          currentStage: finalRun.current_stage,
          summary: finalRun.summary ?? verification.summary,
          createdAt: finalRun.created_at,
          startedAt: finalRun.started_at,
          completedAt: finalRun.completed_at,
        },
      }).catch(() => null)

      return {
        runId,
        status: finalStatus,
        artifactIds: evidence.artifactIds,
      }
    } catch (error) {
      if (error instanceof ManagedRunCancelledError) {
        return {
          runId,
          status: "cancelled" as const,
          artifactIds: [],
        }
      }
      throw error
    }
  },
)
