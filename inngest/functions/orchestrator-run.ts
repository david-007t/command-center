import { promises as fs } from "fs"
import path from "path"
import { execFile, spawn } from "child_process"
import { promisify } from "util"

import { inngest, ORCHESTRATOR_RUN_EVENT } from "../client"
import {
  assertEvidenceBeforeDone,
  createOrchestratorRun,
  createRunArtifact,
  listRunArtifacts,
  readInngestManagedRun,
  updateRunRecord,
  upsertTrackedStep,
} from "@/lib/inngest-run-store"
import { COMMAND_CENTER_PROJECT } from "@/lib/managed-projects"
import { recordRuntimeEvent } from "@/lib/runtime-events"
import type { RuntimeJob } from "@/lib/orchestration"
import { ManagedRunCancelledError, clearActiveProcessPid, setActiveProcessPid, throwIfCancellationRequested } from "./cancellation"

const execFileAsync = promisify(execFile)

async function transitionRunStage(params: {
  runId: string
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
    },
  })

  await recordRuntimeEvent({
    eventType: "run_stage_changed",
    title: `System - ${params.currentStage.replaceAll("_", " ")} in progress`,
    body: params.summary,
    projectName: COMMAND_CENTER_PROJECT,
    scope: "system",
    reason: "job_update",
    job: {
      id: updated.id,
      projectName: null,
      runTemplate: updated.run_template,
      instruction: updated.instruction,
      status: updated.status,
      currentStage: updated.current_stage,
      summary: updated.summary ?? params.summary,
      createdAt: updated.created_at,
      startedAt: updated.started_at,
      completedAt: updated.completed_at,
    },
    payload: {
      projectName: null,
    },
  }).catch(() => null)

  return updated
}

async function runOrchestrator(runId: string, workingDirectory: string, logPath: string) {
  const pythonPath = path.join(workingDirectory, ".venv", "bin", "python")
  const logChunks: string[] = []
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(pythonPath, ["main.py"], {
      cwd: workingDirectory,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    void setActiveProcessPid(runId, child.pid ?? null)

    child.stdout?.on("data", (chunk) => {
      logChunks.push(chunk.toString())
    })
    child.stderr?.on("data", (chunk) => {
      logChunks.push(chunk.toString())
    })
    child.on("error", reject)
    child.on("close", (code) => {
      void clearActiveProcessPid(runId)
      resolve(code ?? 1)
    })
  }).catch(async (error) => {
    logChunks.push(`Failed to launch orchestrator: ${error instanceof Error ? error.message : "unknown error"}`)
    await clearActiveProcessPid(runId).catch(() => null)
    return 1
  })

  const combinedLog = logChunks.join("")
  await fs.writeFile(logPath, combinedLog, "utf8").catch(() => null)
  return {
    exitCode,
    logPreview: combinedLog,
  }
}

export const orchestratorRunFunction = inngest.createFunction(
  {
    id: "command-center-orchestrator-run",
    retries: 2,
    triggers: { event: ORCHESTRATOR_RUN_EVENT },
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

    const metadata = (run.metadata ?? {}) as Record<string, unknown>
    const workingDirectory = String(metadata.workingDirectory ?? "")
    const logPath = path.join(workingDirectory, `.orchestrator-${runId}.log`)

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
          stage,
          jobType: "orchestrator_run",
        },
      })

      await transitionRunStage({
        runId,
        status: "running",
        currentStage: stage,
        summary:
          stage === "reading_context"
            ? "Reading orchestrator context."
            : stage === "planning"
              ? "Planning the orchestrator run."
              : stage === "executing"
                ? "Executing the orchestrator run."
                : stage === "verifying"
                  ? "Verifying the orchestrator run."
                  : "Updating runtime records.",
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
          error: {
            message: error instanceof Error ? error.message : "Unknown Inngest step error.",
          },
        })
        throw error
      }
    }

    try {
      await throwIfCancellationRequested(runId)

      await tracked("read-context", "reading_context", async () => ({
        workingDirectory,
        instruction: run.instruction,
      }))
      await tracked("plan-assignment", "planning", async () => ({
        instruction: run.instruction,
      }))

      const execution = await tracked("execute-orchestrator", "executing", async () =>
        runOrchestrator(runId, workingDirectory, logPath),
      )
      const verification = await tracked("verify-outcome", "verifying", async () => ({
        jobStatus: execution.exitCode === 0 ? "completed" : "blocked",
        summary:
          execution.exitCode === 0
            ? "Orchestrator run completed and refreshed scout/runtime artifacts."
            : "Orchestrator run failed. Check the log and evidence artifacts for details.",
      }))

      const evidence = await tracked("write-evidence", "updating_governance", async () => {
        const created = []
        created.push(
          await createRunArtifact({
            projectName: COMMAND_CENTER_PROJECT,
            runId,
            artifactType: "execution_log",
            label: "Execution log",
            content: execution.logPreview,
          }),
        )
        created.push(
          await createRunArtifact({
            projectName: COMMAND_CENTER_PROJECT,
            runId,
            artifactType: "verification",
            label: "Verification summary",
            content: verification.summary,
          }),
        )
        created.push(
          await createRunArtifact({
            projectName: COMMAND_CENTER_PROJECT,
            runId,
            artifactType: "message_preview",
            label: "Final summary",
            content: verification.summary,
          }),
        )
        return {
          artifactIds: created.map((artifact) => artifact?.id).filter(Boolean),
        }
      })

      const finalizedAt = new Date().toISOString()
      const artifacts = await listRunArtifacts(runId)
      assertEvidenceBeforeDone({
        run: {
          status: verification.jobStatus === "completed" ? "completed" : verification.jobStatus,
          current_stage: verification.jobStatus === "completed" ? "done" : "blocked",
        },
        artifacts,
      })

      const finalRun = await updateRunRecord(runId, {
        status: verification.jobStatus,
        current_stage: verification.jobStatus === "completed" ? "done" : "blocked",
        summary: verification.summary,
        completed_at: finalizedAt,
        metadata: {
          stageUpdatedAt: finalizedAt,
          exitCode: execution.exitCode,
          activeProcessPid: null,
        },
      })

      await recordRuntimeEvent({
        eventType: verification.jobStatus === "completed" ? "run_completed" : "run_blocked",
        title: verification.jobStatus === "completed" ? "Orchestrator run completed" : "Orchestrator run blocked",
        body: verification.summary,
        projectName: COMMAND_CENTER_PROJECT,
        scope: "system",
        reason: "job_update",
        job: {
          id: finalRun.id,
          projectName: null,
          runTemplate: finalRun.run_template,
          instruction: finalRun.instruction,
          status: finalRun.status,
          currentStage: finalRun.current_stage,
          summary: finalRun.summary ?? verification.summary,
          createdAt: finalRun.created_at,
          startedAt: finalRun.started_at,
          completedAt: finalRun.completed_at,
        },
        payload: {
          projectName: null,
        },
      }).catch(() => null)

      await fs.rm(logPath, { force: true }).catch(() => null)

      return {
        runId,
        status: verification.jobStatus,
        artifactIds: evidence.artifactIds,
      }
    } catch (error) {
      await fs.rm(logPath, { force: true }).catch(() => null)
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
