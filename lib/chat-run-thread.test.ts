import test from "node:test"
import assert from "node:assert/strict"
import { buildChatRunEvent } from "./chat-run-thread.ts"
import type { RuntimeJob } from "./orchestration.ts"

function makeJob(overrides: Partial<RuntimeJob> = {}): RuntimeJob {
  return {
    id: "job_123",
    type: "project_task",
    runTemplate: "investigate_issue",
    projectName: "anelo",
    instruction: "Investigate the missing stage preview and verify the result.",
    successCriteria: [],
    governanceTargets: ["TASKS.md", "HANDOFF.md"],
    status: "running",
    createdAt: "2026-04-15T18:00:00.000Z",
    startedAt: "2026-04-15T18:00:05.000Z",
    completedAt: null,
    logPath: "/tmp/job.log",
    messagePath: "/tmp/job.md",
    commentaryPath: "/tmp/job-commentary.md",
    workingDirectory: "/Users/ohsay22/Developer/anelo",
    summary: "Worker launched.",
    exitCode: null,
    pid: 123,
    currentStage: "planning",
    stageUpdatedAt: "2026-04-15T18:00:10.000Z",
    chatThreadId: "thread_project_anelo",
    ...overrides,
  }
}

test("buildChatRunEvent produces a live in-thread operator update for running work", () => {
  const event = buildChatRunEvent(
    makeJob(),
    "## Current step\nPlanning the narrowest safe next move.\n\n## Findings\nGitHub has stage but Vercel has no matching preview yet.",
    "",
  )

  assert.equal(event.kind, "live")
  assert.equal(event.chatThreadId, "thread_project_anelo")
  assert.match(event.title, /planning/i)
  assert.match(event.body, /GitHub has stage/i)
})

test("buildChatRunEvent produces a final verified outcome message for completed work", () => {
  const event = buildChatRunEvent(
    makeJob({
      status: "completed",
      currentStage: "done",
      completedAt: "2026-04-15T18:05:00.000Z",
      summary: "Codex worker completed the requested project task.",
    }),
    "## Verification\nThe stage preview is now visible in Vercel.",
    "Outcome\n\nThe stage deployment is now verified.\n\nVerification\n\nChecked the Vercel deployment state and confirmed the preview URL.",
  )

  assert.equal(event.kind, "final")
  assert.match(event.title, /verified outcome/i)
  assert.match(event.body, /stage deployment is now verified/i)
})

test("buildChatRunEvent normalizes operator commentary into trust-oriented sections", () => {
  const event = buildChatRunEvent(
    makeJob({ currentStage: "executing" }),
    [
      "## What I checked",
      "GitHub stage branch, linked Vercel project, latest deployment records.",
      "",
      "## What I found",
      "GitHub has the branch, but Vercel still has no READY stage preview.",
      "",
      "## Likely cause",
      "The branch exists upstream, but the deployment trigger did not create a preview.",
      "",
      "## What I'm doing next",
      "Re-check Vercel after the narrow remediation path.",
      "",
      "## Verified vs inferred",
      "Verified: stage branch exists on GitHub. Inferred: Vercel trigger did not fire cleanly.",
    ].join("\n"),
    "",
  )

  assert.match(event.body, /What I checked/i)
  assert.match(event.body, /What I found/i)
  assert.match(event.body, /Likely cause/i)
  assert.match(event.body, /What I'm doing next/i)
  assert.match(event.body, /Verified vs inferred/i)
})

test("buildChatRunEvent remaps legacy commentary headings into trust-oriented labels", () => {
  const event = buildChatRunEvent(
    makeJob(),
    ["## Current step", "Reading runtime evidence.", "", "## Findings", "Vercel has no READY preview yet.", "", "## Next move", "Run the narrowest safe remediation."].join("\n"),
    "",
  )

  assert.doesNotMatch(event.body, /^## /m)
  assert.match(event.body, /\*\*What I'm doing now\*\*/i)
  assert.match(event.body, /\*\*What I found\*\*/i)
  assert.match(event.body, /\*\*What I'm doing next\*\*/i)
})
