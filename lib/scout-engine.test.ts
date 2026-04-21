import test from "node:test"
import assert from "node:assert/strict"
import { buildDailyScoutBrief } from "./scout-engine.ts"

test("buildDailyScoutBrief prioritizes investigations and command-center self-improvement work", () => {
  const brief = buildDailyScoutBrief({
    projects: [
      {
        name: "anelo",
        phase: "BUILD",
        progress: 80,
        blocker: "Preview trust gap",
        nextAction: "Investigate preview deployment",
        launchTarget: "2026-04-30",
        sprintGoal: "Fix preview confidence",
        inProgress: [],
        blockedItems: [],
        upNext: [],
        latestHandoff: { whatWorks: "", whatIsBroken: "", nextSteps: [] },
        activeError: { description: "", impact: "" },
        ceoDecision: null,
        recommendedAction: { template: "investigate_issue", label: "Investigate issue", reason: "Need proof first." },
        investigation: {
          title: "Investigate missing preview",
          summary: "Stage preview has not been verified.",
          checks: [],
          likelyCause: "First preview has not been externally confirmed.",
          nextStep: "Run the deployment investigation.",
          canAutofix: true,
          suggestedTemplate: "investigate_issue",
          suggestedInstruction: "Investigate the preview gap.",
          status: "blocked",
        },
        runtimeState: {
          projectName: "anelo",
          jobId: "job_1",
          runTemplate: "investigate_issue",
          status: "blocked",
          statusLabel: "Blocked",
          summary: "Blocked",
          governanceUpdated: true,
          governanceTargets: [],
          updatedTargets: [],
          missingTargets: [],
          completedAt: null,
          messagePreview: "",
          currentStage: null,
          stageUpdatedAt: null,
          trust: { level: "unverified", headline: "Preview proof missing.", checks: [] },
        },
        jobs: [],
      },
    ],
    feedback: [
      {
        id: "fb_1",
        createdAt: "2026-04-15T12:00:00.000Z",
        scope: "system",
        projectName: "command-center",
        category: "self_heal",
        severity: "high",
        summary: "The operating system should manage itself directly.",
        desiredOutcome: "Command Center becomes a first-class project.",
        status: "actioning",
        source: "chat",
        relatedJobId: "job_2",
        resolutionNote: null,
      },
    ],
    usageStatus: "watch",
  })

  assert.equal(brief.recommendations[0]?.projectName, "anelo")
  assert.ok(brief.recommendations.some((item) => item.projectName === "command-center"))
  assert.match(brief.headline, /Investigate missing preview|needs attention/i)
})
