import test from "node:test"
import assert from "node:assert/strict"
import type { ChatThreadMessage } from "../chat-thread-messages.ts"
import {
  buildPortfolioResponseFromStore,
  mergeThreadMessagesPreservingRunEvents,
  projectRowToProjectStatus,
  type Phase1DashboardSnapshot,
  type Phase1ProjectRow,
} from "./phase1-serialization.ts"

test("mergeThreadMessagesPreservingRunEvents keeps stored run events missing from the latest browser save", () => {
  const existing: ChatThreadMessage[] = [
    {
      id: "welcome",
      role: "assistant",
      content: "anelo loaded.",
      source: "chat",
    },
    {
      id: "run-job-1",
      role: "assistant",
      content: "Verified run result",
      source: "run_event",
      jobId: "job-1",
      updatedAt: "2026-04-15T21:13:00.000Z",
    },
  ]

  const incoming: ChatThreadMessage[] = [
    {
      id: "welcome",
      role: "assistant",
      content: "anelo loaded.",
      source: "chat",
    },
    {
      id: "user-1",
      role: "user",
      content: "What changed?",
      source: "chat",
    },
  ]

  const merged = mergeThreadMessagesPreservingRunEvents(existing, incoming)

  assert.equal(merged.filter((message) => message.source === "run_event").length, 1)
  assert.equal(merged.find((message) => message.jobId === "job-1")?.content, "Verified run result")
  assert.equal(merged.at(-1)?.jobId, "job-1")
})

test("projectRowToProjectStatus returns the stored Phase 1 project snapshot", () => {
  const row: Phase1ProjectRow = {
    id: "project-1",
    name: "anelo",
    display_name: "Anelo",
    metadata: {
      phase1: {
        projectStatus: {
          name: "anelo",
          phase: "BUILD",
          progress: 82,
          blocker: "Need proof",
          nextAction: "Verify preview",
          launchTarget: "2026-04-30",
          sprintGoal: "Ship",
          inProgress: ["Fix preview"],
          blockedItems: [],
          upNext: ["QA"],
          latestHandoff: {
            whatWorks: "Pages load",
            whatIsBroken: "Preview missing",
            nextSteps: ["Verify Vercel"],
          },
          activeError: {
            description: "Missing preview",
            impact: "Blocks review",
          },
          ceoDecision: null,
          recommendedAction: {
            template: "investigate_issue",
            label: "Investigate issue",
            reason: "Need proof",
          },
          investigation: null,
          jobs: [],
          runtimeState: null,
        },
      },
    },
  }

  const snapshot = projectRowToProjectStatus(row)

  assert.ok(snapshot)
  assert.equal(snapshot.name, "anelo")
  assert.equal(snapshot.nextAction, "Verify preview")
})

test("buildPortfolioResponseFromStore combines stored dashboard metadata with project summaries", () => {
  const rows: Phase1ProjectRow[] = [
    {
      id: "project-cc",
      name: "command-center",
      display_name: "Command Center",
      metadata: {
        phase1: {
          portfolioProject: {
            name: "command-center",
            phase: "BUILD",
            progress: 70,
            blocker: "None",
            nextAction: "Continue migration",
            launchTarget: "Internal OS",
            latestHandoff: "Migration in progress",
            runtimeState: null,
          },
          dashboard: {
            activeBuildSlot: {
              projectName: "command-center",
              phase: "BUILD",
              progress: 70,
              lastSession: "Migration in progress",
              nextAction: "Continue migration",
              blockers: "None",
            },
            buildQueue: ["leadqual"],
            pendingDecisions: [],
            decisionItems: [],
            scoutSummary: "No scout report yet.",
            systemHealth: {
              orchestratorLastActive: "Not run yet",
              templatesVersion: "1.0",
              productsShipped: 0,
            },
            recentFeedback: [],
            activeRuns: [],
          } satisfies Phase1DashboardSnapshot,
        },
      },
    },
    {
      id: "project-anelo",
      name: "anelo",
      display_name: "Anelo",
      metadata: {
        phase1: {
          portfolioProject: {
            name: "anelo",
            phase: "BUILD",
            progress: 82,
            blocker: "Need proof",
            nextAction: "Verify preview",
            launchTarget: "2026-04-30",
            latestHandoff: "Preview still needs proof",
            runtimeState: {
              status: "blocked",
              statusLabel: "Blocked",
              summary: "Waiting on deployment proof",
            },
          },
        },
      },
    },
  ]

  const response = buildPortfolioResponseFromStore(rows)

  assert.equal(response.projects.length, 2)
  assert.equal(response.projects[1]?.name, "anelo")
  assert.equal(response.activeBuildSlot.projectName, "command-center")
  assert.deepEqual(response.buildQueue, ["leadqual"])
})
