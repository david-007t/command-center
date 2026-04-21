import test from "node:test"
import assert from "node:assert/strict"
import { buildProjectNeedsReply, buildProjectStatusReplyWithRunner, buildWorkerRunnerUnavailableReply, isLikelyProjectNeedsRequest, isLikelyQueueBlockerRequest } from "./project-chat-core.ts"

test("isLikelyQueueBlockerRequest catches queued runner questions", () => {
  assert.equal(isLikelyQueueBlockerRequest("why is it still queued? whats stopping it from running"), true)
  assert.equal(isLikelyQueueBlockerRequest("status update"), false)
})

test("isLikelyProjectNeedsRequest catches next-step questions", () => {
  assert.equal(isLikelyProjectNeedsRequest("what does leadqual need right now"), true)
  assert.equal(isLikelyProjectNeedsRequest("what should i do next"), true)
  assert.equal(isLikelyProjectNeedsRequest("proceed"), false)
})

test("buildWorkerRunnerUnavailableReply states that the local runner is missing", () => {
  const reply = buildWorkerRunnerUnavailableReply("leadqual", { id: "job-123", status: "queued" })

  assert.match(reply, /local worker runner/i)
  assert.match(reply, /job-123/i)
  assert.match(reply, /Inngest dev runner is not reachable/i)
})

test("buildProjectNeedsReply prioritizes CEO decision state", () => {
  const reply = buildProjectNeedsReply("leadqual", {
    runtimeState: null,
    investigation: null,
    ceoDecision: {
      projectName: "leadqual",
      title: "Decision needed",
      reason: "Choose whether v1 remains single-user.",
      recommendation: "Keep v1 single-user and align the release gates.",
      priority: "critical",
      source: "runtime",
    },
    blocker: "",
    nextAction: "",
    recommendedAction: {
      template: "review_next_move",
      label: "Review next move",
      reason: "A decision is required.",
    },
    activeError: {
      description: "",
      impact: "",
    },
  })

  assert.match(reply, /needs your decision/i)
  assert.match(reply, /single-user/i)
})

test("buildProjectStatusReplyWithRunner adds the runner warning for queued jobs", () => {
  const reply = buildProjectStatusReplyWithRunner(
    "leadqual",
    [
      {
        id: "job-queued",
        type: "project_task",
        runTemplate: "continue_project",
        projectName: "leadqual",
        instruction: "Continue leadqual",
        status: "queued",
        statusLabel: "Queued",
        createdAt: "2026-04-18T16:00:00.000Z",
        completedAt: null,
        summary: "Worker launched.",
        messagePreview: "Worker launched.",
        commentaryPreview: "",
        executiveMessage: "Worker launched.",
        logPreview: "",
        logPath: "/tmp/job.log",
        successCriteria: [],
        governanceTargets: [],
        currentStage: "queued",
        stageUpdatedAt: "2026-04-18T16:00:00.000Z",
      },
    ],
    {
      runtimeState: null,
      jobs: [],
    },
    false,
  )

  assert.match(reply, /latest worker status: queued/i)
  assert.match(reply, /Inngest dev runner is not reachable/i)
})
