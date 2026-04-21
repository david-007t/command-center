import test from "node:test"
import assert from "node:assert/strict"
import {
  buildProjectDecisionExplanationReply,
  buildProjectDecisionReply,
  buildProjectStatusReply,
  detectDecisionSelection,
  isLikelyDecisionExplanationRequest,
  isLikelyDecisionRequest,
  isLikelyStatusRequest,
} from "./project-chat-status.ts"
import type { RuntimeJob } from "./orchestration.ts"
import type { ProjectStatus } from "./project-status.ts"

function makeJob(overrides: Partial<RuntimeJob>): RuntimeJob {
  return {
    id: "job-1",
    type: "project_task",
    runTemplate: "fix_issue",
    projectName: "anelo",
    chatThreadId: "thread-1",
    instruction: "Fix the digest page",
    status: "completed",
    summary: "Digest error now surfaces the real Supabase failure.",
    logPath: "/tmp/log.md",
    messagePath: "/tmp/message.md",
    commentaryPath: "/tmp/commentary.md",
    pid: null,
    createdAt: "2026-04-15T21:00:00.000Z",
    completedAt: "2026-04-15T21:13:00.000Z",
    successCriteria: [],
    governanceTargets: [],
    currentStage: "done",
    stageUpdatedAt: "2026-04-15T21:13:00.000Z",
    initialGitHead: "abc123",
    ...overrides,
  }
}

test("isLikelyStatusRequest catches direct worker status questions", () => {
  assert.equal(isLikelyStatusRequest("is it still running?"), true)
  assert.equal(isLikelyStatusRequest("did that job finish yet"), true)
  assert.equal(isLikelyStatusRequest("fix the digest page"), false)
})

test("isLikelyDecisionRequest catches direct decision questions", () => {
  assert.equal(isLikelyDecisionRequest("whats the decision needed"), true)
  assert.equal(isLikelyDecisionRequest("what is the decision? im confused, u havent made it clear"), true)
  assert.equal(isLikelyDecisionRequest("do you need my approval"), true)
  assert.equal(isLikelyDecisionRequest("fix the digest page"), false)
})

test("isLikelyDecisionExplanationRequest catches clarification requests", () => {
  assert.equal(isLikelyDecisionExplanationRequest("explain the decision"), true)
  assert.equal(isLikelyDecisionExplanationRequest("what is the decision? im confused, u havent made it clear"), true)
  assert.equal(isLikelyDecisionExplanationRequest("status update"), false)
})

test("detectDecisionSelection recognizes local leadqual scope decisions", () => {
  assert.equal(detectDecisionSelection("I said make it single user", "leadqual"), "single_user_v1")
  assert.equal(detectDecisionSelection("fine, add auth and RLS", "leadqual"), "auth_rls_v1")
  assert.equal(detectDecisionSelection("status update", "leadqual"), null)
})

test("buildProjectStatusReply uses live completion state instead of assuming a run is still active", () => {
  const reply = buildProjectStatusReply("anelo", [
    makeJob({ status: "running", completedAt: null, currentStage: "executing", stageUpdatedAt: "2026-04-15T21:10:00.000Z" }),
    makeJob({ id: "job-2", status: "completed", completedAt: "2026-04-15T21:13:00.000Z", stageUpdatedAt: "2026-04-15T21:13:00.000Z" }),
  ])

  assert.match(reply, /latest worker status: completed/i)
  assert.match(reply, /Completed at 2026-04-15T21:13:00.000Z/)
})

test("buildProjectStatusReply falls back to project runtime state when this chat thread has no runs", () => {
  const projectStatus = {
    runtimeState: {
      projectName: "rbc",
      jobId: "job-9",
      runTemplate: "continue_project",
      status: "blocked",
      statusLabel: "Blocked",
      summary: "The system reached a blocker and needs direction before development continues.",
      governanceUpdated: false,
      governanceTargets: ["TASKS.md", "HANDOFF.md"],
      updatedTargets: [],
      missingTargets: ["TASKS.md", "HANDOFF.md"],
      completedAt: "2026-04-16T11:38:30.598Z",
      messagePreview: "A recent run is blocked on missing project inputs.",
      currentStage: "blocked",
      stageUpdatedAt: "2026-04-16T11:38:30.598Z",
      trust: {
        level: "unverified",
        headline: "Some important claims are not yet verified by evidence.",
        checks: [],
      },
    },
    jobs: [
      {
        ...makeJob({
          id: "job-9",
          projectName: "rbc",
          status: "blocked",
          completedAt: "2026-04-16T11:38:30.598Z",
          currentStage: "blocked",
          stageUpdatedAt: "2026-04-16T11:38:30.598Z",
          summary: "Codex worker ended in a blocked state.",
        }),
        statusLabel: "Blocked",
        messagePreview: "No summary recorded yet.",
        commentaryPreview: "No summary recorded yet.",
        executiveMessage: "Codex worker ended in a blocked state.",
        logPreview: "No summary recorded yet.",
      },
    ],
  } satisfies Pick<ProjectStatus, "runtimeState" | "jobs">

  const reply = buildProjectStatusReply("rbc", [], projectStatus)

  assert.doesNotMatch(reply, /has no worker runs yet in this chat thread/i)
  assert.match(reply, /project runtime status: blocked/i)
  assert.match(reply, /Latest project job: job-9/i)
  assert.match(reply, /A recent run is blocked on missing project inputs/i)
})

test("buildProjectDecisionReply answers directly from project decision state", () => {
  const projectStatus = {
    ceoDecision: {
      projectName: "leadqual",
      title: "Decision needed",
      reason: "The system completed its review and is waiting on a decision from you.",
      recommendation: "Review the recommendation before approving more work.",
      explanation: "The system surfaced a decision point that needs an explicit operator call.",
      evidence: [],
      options: [],
      defaultOptionId: null,
      priority: "important" as const,
      source: "runtime" as const,
    },
    runtimeState: {
      projectName: "leadqual",
      jobId: "job-7",
      runTemplate: "prep_qa",
      status: "awaiting_ceo",
      statusLabel: "Needs your decision",
      summary: "The system completed its review and is waiting on a decision from you.",
      governanceUpdated: true,
      governanceTargets: ["TASKS.md"],
      updatedTargets: ["TASKS.md"],
      missingTargets: [],
      completedAt: "2026-04-17T01:28:35.353Z",
      messagePreview: "The system found a decision point and paused further build work until you choose the primary direction.",
      currentStage: "done",
      stageUpdatedAt: "2026-04-17T01:28:35.353Z",
      trust: {
        level: "confirmed",
        headline: "The project state is verified.",
        checks: [],
      },
    },
    jobs: [
      {
        ...makeJob({
          id: "job-7",
          projectName: "leadqual",
          runTemplate: "prep_qa",
          status: "awaiting_ceo",
          completedAt: "2026-04-17T01:28:35.353Z",
          currentStage: "done",
          stageUpdatedAt: "2026-04-17T01:28:35.353Z",
          summary: "Codex worker completed and surfaced a CEO decision.",
        }),
        statusLabel: "Needs your decision",
        messagePreview: "The system found a decision point and paused further build work until you choose the primary direction.",
        commentaryPreview: "No summary recorded yet.",
        executiveMessage: "The system completed its review and is waiting on a decision from you.",
        logPreview: "No summary recorded yet.",
      },
    ],
  } satisfies Pick<ProjectStatus, "ceoDecision" | "runtimeState" | "jobs">

  const reply = buildProjectDecisionReply("leadqual", projectStatus)

  assert.match(reply, /leadqual needs a decision/i)
  assert.match(reply, /Call: The system completed its review and is waiting on a decision from you\./i)
  assert.match(reply, /Latest job: job-7/i)
  assert.match(reply, /Recommendation: Review the recommendation before approving more work/i)
  assert.doesNotMatch(reply, /Reason:/i)
})

test("buildProjectDecisionReply extracts the actual executive call from a verbose decision reason", () => {
  const reply = buildProjectDecisionReply("leadqual", {
    ceoDecision: {
      projectName: "leadqual",
      title: "Decision needed",
      reason:
        "Outcome Prep for QA is complete at the governance level, but release readiness remains blocked. CEO DECISION NEEDED: the repo still presents as a single-user localStorage SPA while the current QA/security gates require auth/RLS and protected-route behavior. Verification I ran npm run build and npm audit.",
      recommendation:
        "Review the recommendation before approving more work. After that decision, run vercel dev with valid env vars and execute the AI lead-generation happy path end to end.",
      explanation: "The system surfaced a decision point that needs an explicit operator call.",
      evidence: [],
      options: [],
      defaultOptionId: null,
      priority: "important" as const,
      source: "runtime" as const,
    },
    runtimeState: {
      projectName: "leadqual",
      jobId: "job-8",
      runTemplate: "prep_qa",
      status: "awaiting_ceo",
      statusLabel: "Needs your decision",
      summary: "The system completed its review and is waiting on a decision from you.",
      governanceUpdated: true,
      governanceTargets: ["TASKS.md"],
      updatedTargets: ["TASKS.md"],
      missingTargets: [],
      completedAt: "2026-04-17T01:28:35.353Z",
      messagePreview: "CEO decision required.",
      currentStage: "done",
      stageUpdatedAt: "2026-04-17T01:28:35.353Z",
      trust: {
        level: "confirmed",
        headline: "The project state is verified.",
        checks: [],
      },
    },
    jobs: [],
  })

  assert.match(
    reply,
    /Call: the repo still presents as a single-user localStorage SPA while the current QA\/security gates require auth\/RLS and protected-route behavior\./i,
  )
  assert.match(reply, /Recommendation: Review the recommendation before approving more work\./i)
  assert.doesNotMatch(reply, /Verification I ran npm run build/i)
})

test("buildProjectDecisionExplanationReply explains the leadqual decision as a tradeoff", () => {
  const reply = buildProjectDecisionExplanationReply("leadqual", {
    ceoDecision: {
      projectName: "leadqual",
      title: "Decision needed",
      reason:
        "Outcome Prep for QA is complete at the governance level, but release readiness remains blocked. CEO DECISION NEEDED: the repo still presents as a single-user localStorage SPA while the current QA/security gates require auth/RLS and protected-route behavior.",
      recommendation: "Choose the simpler v1 unless broader rollout is urgent.",
      explanation: "The system surfaced a decision point that needs an explicit operator call.",
      evidence: [],
      options: [],
      defaultOptionId: null,
      priority: "important" as const,
      source: "runtime" as const,
    },
    runtimeState: {
      projectName: "leadqual",
      jobId: "job-8",
      runTemplate: "prep_qa",
      status: "awaiting_ceo",
      statusLabel: "Needs your decision",
      summary: "The system completed its review and is waiting on a decision from you.",
      governanceUpdated: true,
      governanceTargets: ["TASKS.md"],
      updatedTargets: ["TASKS.md"],
      missingTargets: [],
      completedAt: "2026-04-17T01:28:35.353Z",
      messagePreview: "CEO decision required.",
      currentStage: "done",
      stageUpdatedAt: "2026-04-17T01:28:35.353Z",
      trust: {
        level: "confirmed",
        headline: "The project state is verified.",
        checks: [],
      },
    },
    jobs: [
      {
        ...makeJob({
          id: "job-8",
          projectName: "leadqual",
          runTemplate: "prep_qa",
          status: "awaiting_ceo",
          completedAt: "2026-04-17T01:28:35.353Z",
          currentStage: "done",
          stageUpdatedAt: "2026-04-17T01:28:35.353Z",
        }),
        statusLabel: "Needs your decision",
        messagePreview: "CEO decision required.",
        commentaryPreview: "No summary recorded yet.",
        executiveMessage: "Decision required.",
        logPreview: "No summary recorded yet.",
      },
    ],
  })

  assert.match(reply, /Here’s the decision in plain English for leadqual\./i)
  assert.match(reply, /single-user tool/i)
  assert.match(reply, /whether v1 should stay a simpler single-user release/i)
  assert.match(reply, /Recommended path: Choose the simpler v1 unless broader rollout is urgent\./i)
})
