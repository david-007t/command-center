import test from "node:test"
import assert from "node:assert/strict"
import { promises as fs } from "fs"
import os from "os"
import path from "path"
import {
  getStageMeta,
  recommendRunTemplateForProject,
  summarizeRecommendedAction,
  type ProjectRuntimeState,
  type RuntimeJobStage,
} from "./orchestration.ts"

test("getStageMeta returns ordered plan metadata for worker stages", () => {
  const stageOrder: RuntimeJobStage[] = [
    "queued",
    "reading_context",
    "planning",
    "executing",
    "verifying",
    "updating_governance",
    "done",
  ]

  const labels = stageOrder.map((stage) => getStageMeta(stage).label)

  assert.deepEqual(labels, [
    "Queued",
    "Reading context",
    "Planning",
    "Executing",
    "Verifying",
    "Updating governance",
    "Done",
  ])
  assert.equal(getStageMeta("verifying").index, 4)
})

test("summarizeRecommendedAction does not override an active in-flight stage", () => {
  const runtimeState: ProjectRuntimeState = {
    projectName: "rbc",
    jobId: "job_123",
    runTemplate: "continue_project",
    status: "healthy",
    summary: "Worker is making progress.",
    governanceUpdated: false,
    governanceTargets: ["TASKS.md", "HANDOFF.md"],
    updatedTargets: [],
    missingTargets: ["TASKS.md", "HANDOFF.md"],
    completedAt: null,
    messagePreview: "",
    currentStage: "executing",
  }

  const recommendation = summarizeRecommendedAction(runtimeState)

  assert.equal(recommendation.template, "continue_project")
  assert.match(recommendation.reason, /currently executing/i)
})

test("summarizeRecommendedAction chooses investigate issue for blocked runtime state", () => {
  const runtimeState: ProjectRuntimeState = {
    projectName: "anelo",
    jobId: "job_456",
    runTemplate: "fix_blocker",
    status: "blocked",
    summary: "The latest run is blocked pending diagnosis.",
    governanceUpdated: true,
    governanceTargets: ["TASKS.md", "HANDOFF.md"],
    updatedTargets: ["TASKS.md", "HANDOFF.md"],
    missingTargets: [],
    completedAt: "2026-04-15T10:00:00.000Z",
    messagePreview: "",
    currentStage: "blocked",
  }

  const recommendation = summarizeRecommendedAction(runtimeState)

  assert.equal(recommendation.template, "investigate_issue")
  assert.match(recommendation.reason, /diagnose the cause/i)
})

test("recommendRunTemplateForProject prefers the current sprint task over runtime-gap heuristics for generic work asks", async () => {
  const developerPath = await fs.mkdtemp(path.join(os.tmpdir(), "command-center-dispatch-"))
  const projectName = "rbc"
  const projectDir = path.join(developerPath, projectName)
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(
    path.join(projectDir, "TASKS.md"),
    `# TASKS.md

## Current sprint goal

Ship the next onboarding checkpoint.

## In progress

- [ ] Finish the onboarding checkpoint flow.
`,
    "utf8",
  )

  const template = await recommendRunTemplateForProject({
    developerPath,
    projectName,
    instruction: "keep going on this project",
    runtimeState: {
      projectName,
      jobId: "job_789",
      runTemplate: "investigate_issue",
      status: "blocked",
      summary: "Runtime still shows a blocker.",
      governanceUpdated: true,
      governanceTargets: ["TASKS.md", "HANDOFF.md"],
      updatedTargets: ["TASKS.md", "HANDOFF.md"],
      missingTargets: [],
      completedAt: "2026-04-15T10:00:00.000Z",
      messagePreview: "",
      currentStage: "blocked",
    },
  })

  assert.equal(template, "continue_project")
})

test("recommendRunTemplateForProject still honors explicit investigation requests", async () => {
  const developerPath = await fs.mkdtemp(path.join(os.tmpdir(), "command-center-dispatch-"))
  const projectName = "anelo"
  const projectDir = path.join(developerPath, projectName)
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(
    path.join(projectDir, "TASKS.md"),
    `# TASKS.md

## In progress

- [ ] Ship the current sprint task.
`,
    "utf8",
  )

  const template = await recommendRunTemplateForProject({
    developerPath,
    projectName,
    instruction: "investigate why the preview deploy is broken",
    runtimeState: null,
  })

  assert.equal(template, "investigate_issue")
})
