import { promises as fs } from "fs"
import path from "path"
import { promisify } from "util"
import { execFile } from "child_process"

import { inngest, CONTINUE_PROJECT_EVENT } from "../client"
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
import { writeProjectRuntimeState, type RuntimeJob } from "@/lib/orchestration"
import { runWorkerAgent } from "@/lib/agent-runner"
import { ManagedRunCancelledError, throwIfCancellationRequested } from "./cancellation"

const execFileAsync = promisify(execFile)

async function safeGit(projectDir: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectDir, ...args])
    return stdout.trim()
  } catch {
    return ""
  }
}

function buildPrompt(input: {
  projectName: string
  instruction: string
  governanceTargets: string[]
  successCriteria: string[]
}) {
  return [
    `You are executing a project task inside ${input.projectName}.`,
    "Run type: continue_project.",
    "Read CLAUDE.md, TASKS.md, HANDOFF.md, and ERRORS.md before acting.",
    "Follow the project governance files exactly.",
    `Governance files expected to be updated if state changes: ${input.governanceTargets.join(", ") || "TASKS.md, HANDOFF.md"}.`,
    `User instruction: ${input.instruction}`,
    "Success criteria:",
    ...input.successCriteria.map((item, index) => `${index + 1}. ${item}`),
    "Session rules:",
    "1. Update every required governance target if the project state changed.",
    "2. If you cannot safely continue, mark the outcome as blocked in TASKS.md and explain why in HANDOFF.md.",
    "3. If the outcome requires a business or product decision, state CEO DECISION NEEDED explicitly in the final message and in HANDOFF.md.",
    "4. End with these exact sections: Outcome, Verification, Governance updates, Next step.",
    "5. Return a concise summary with what you changed, what you verified, and any blockers.",
  ].join("\n")
}

async function transitionRunStage(params: {
  runId: string
  projectName: string
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
      runTemplate: updated.run_template,
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

export const continueProjectFunction = inngest.createFunction(
  {
    id: "command-center-continue-project",
    retries: 2,
    triggers: { event: CONTINUE_PROJECT_EVENT },
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
        },
      })

      await transitionRunStage({
        runId,
        projectName,
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
        prompt: buildPrompt({
          projectName,
          instruction: run.instruction,
          governanceTargets,
          successCriteria,
        }),
      }))

      await tracked("plan-assignment", "planning", async () => ({
        instruction: run.instruction,
        governanceTargets,
        successCriteria,
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
        const outcome = classifyWorkerOutcome({
          finalJob: {
            type: "project_task",
            status: execution.exitCode === 0 ? "completed" : "failed",
            runTemplate: "continue_project",
            initialGitHead: execution.headBefore,
          },
          messagePreview: execution.messagePreview,
          headAfter: execution.headAfter,
          changedFiles: execution.changedFiles,
          logPreview: execution.logPreview,
        })

        return outcome
      })

      const evidence = await tracked("write-evidence", "updating_governance", async () => {
        const created = []
        created.push(
          await createRunArtifact({
            projectName,
            runId,
            artifactType: "message_preview",
            label: "Final message",
            content: execution.messagePreview,
          }),
        )
        created.push(
          await createRunArtifact({
            projectName,
            runId,
            artifactType: "execution_log",
            label: "Execution log",
            content: execution.logPreview,
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
          runTemplate: "continue_project",
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
