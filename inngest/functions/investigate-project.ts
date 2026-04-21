import { promises as fs } from "fs"
import { createRequire } from "module"
import os from "os"
import path from "path"
import { spawn, execFile } from "child_process"
import { promisify } from "util"

import { inngest, INVESTIGATE_PROJECT_EVENT } from "../client"
import {
  assertEvidenceBeforeDone,
  createRunArtifact,
  listRunArtifacts,
  readInngestManagedRun,
  updateRunRecord,
  upsertTrackedStep,
} from "@/lib/inngest-run-store"
import { readInvestigationRecord, type InvestigationRecord } from "@/lib/project-investigation"
import { recordProjectRuntimeUpdated, recordRuntimeEvent } from "@/lib/runtime-events"
import { loadWorkerEnv } from "@/lib/worker-env"
import { buildRuntimeStateFromFinalJob, classifyWorkerOutcome } from "@/lib/worker-outcome"
import { writeProjectRuntimeState, type RuntimeJob } from "@/lib/orchestration"
import { ManagedRunCancelledError, clearActiveProcessPid, setActiveProcessPid, throwIfCancellationRequested } from "./cancellation"
import { buildInvestigateProjectPrompt } from "./investigate-project-prompt"

const execFileAsync = promisify(execFile)
const codexPath = "/Applications/Codex.app/Contents/Resources/codex"
const require = createRequire(import.meta.url)

async function safeGit(projectDir: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectDir, ...args])
    return stdout.trim()
  } catch {
    return ""
  }
}

async function runCodex(prompt: string, workingDirectory: string, runId: string) {
  const outputDir = path.join(os.tmpdir(), "command-center-inngest")
  await fs.mkdir(outputDir, { recursive: true })
  const messagePath = path.join(outputDir, `${runId}.md`)
  const logChunks: string[] = []
  const workerEnv = await loadWorkerEnv(workingDirectory, process.env)
  const nodeDir = path.dirname(process.execPath)
  const currentPath = workerEnv.PATH || process.env.PATH || ""
  const pathEntries = currentPath.split(path.delimiter).filter(Boolean)

  const env = {
    ...workerEnv,
    PATH: [nodeDir, ...pathEntries.filter((entry) => entry !== nodeDir)].join(path.delimiter),
  }

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      codexPath,
      [
        "exec",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "--cd",
        workingDirectory,
        "--output-last-message",
        messagePath,
        prompt,
      ],
      {
        cwd: workingDirectory,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
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
  })

  const messagePreview = await fs.readFile(messagePath, "utf8").catch(() => "")
  return {
    exitCode,
    messagePreview,
    logPreview: logChunks.join(""),
  }
}

async function runProjectInvestigation(
  workingDirectory: string,
  projectName: string,
  attemptRemediation: boolean,
): Promise<{ filePath: string; record: InvestigationRecord } | null> {
  const module = require("../../scripts/project-investigation.js") as {
    runProjectInvestigation: (
      projectDir: string,
      projectName: string,
      options: { attemptRemediation: boolean },
    ) => Promise<{ filePath: string; record: InvestigationRecord }>
  }
  return module.runProjectInvestigation(workingDirectory, projectName, { attemptRemediation }).catch(() => null)
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

export const investigateProjectFunction = inngest.createFunction(
  {
    id: "command-center-investigate-project",
    retries: 2,
    triggers: { event: INVESTIGATE_PROJECT_EVENT },
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
          runTemplate: "investigate_issue",
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
      const investigationCapture = await tracked("capture-investigation", "reading_context", async () => {
        return runProjectInvestigation(workingDirectory, projectName, true)
      })

      const prompt = await tracked("read-context", "reading_context", async () => ({
        prompt: buildInvestigateProjectPrompt({
          projectName,
          instruction: run.instruction,
          governanceTargets,
          successCriteria,
          investigation: investigationCapture?.record ?? null,
          investigationArtifactPath: investigationCapture?.filePath ?? null,
        }),
        investigationSummary: investigationCapture?.record?.summary ?? null,
      }))

      await tracked("plan-assignment", "planning", async () => ({
        instruction: run.instruction,
        governanceTargets,
        successCriteria,
        investigationSummary: investigationCapture?.record?.summary ?? null,
      }))

      const execution = await tracked("execute-codex", "executing", async () => {
        const headBefore = await safeGit(workingDirectory, ["rev-parse", "HEAD"])
        const result = await runCodex(prompt.prompt, workingDirectory, runId)
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
            runTemplate: "investigate_issue",
            initialGitHead: execution.headBefore,
          },
          messagePreview: execution.messagePreview,
          headAfter: execution.headAfter,
          changedFiles: execution.changedFiles,
          logPreview: execution.logPreview,
        })
      })

      const evidence = await tracked("write-evidence", "updating_governance", async () => {
      const refreshedInvestigation = await runProjectInvestigation(workingDirectory, projectName, false)
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
      created.push(
        await createRunArtifact({
          projectName,
          runId,
          artifactType: "evidence",
          label: "Investigation evidence",
          content: refreshedInvestigation ? JSON.stringify(refreshedInvestigation.record, null, 2) : null,
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
        runTemplate: "investigate_issue",
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
