import test from "node:test"
import assert from "node:assert/strict"
import { getImplicitProjectLaunch } from "./project-chat-launch.ts"

test("getImplicitProjectLaunch prefers the active investigation launch for a plain approval", () => {
  const launch = getImplicitProjectLaunch("approve", {
    investigation: {
      suggestedTemplate: "investigate_issue",
      suggestedInstruction: "Investigate why anelo does not yet have a verified Vercel stage preview deployment.",
    },
    recommendedAction: {
      template: "continue_project",
    },
  })

  assert.ok(launch)
  assert.equal(launch?.template, "investigate_issue")
  assert.match(launch?.instruction ?? "", /verified Vercel stage preview deployment/i)
  assert.equal(launch?.source, "investigation")
})

test("getImplicitProjectLaunch falls back to the recommended action for bare continue approvals", () => {
  const launch = getImplicitProjectLaunch("ok proceed", {
    investigation: null,
    recommendedAction: {
      template: "continue_project",
    },
  })

  assert.ok(launch)
  assert.equal(launch?.template, "continue_project")
  assert.equal(launch?.instruction, undefined)
  assert.equal(launch?.source, "recommended_action")
})

test("getImplicitProjectLaunch ignores broader messages even when they contain approval words", () => {
  const launch = getImplicitProjectLaunch("approve, but first explain the architecture", {
    investigation: {
      suggestedTemplate: "investigate_issue",
      suggestedInstruction: "Investigate why anelo does not yet have a verified Vercel stage preview deployment.",
    },
    recommendedAction: {
      template: "continue_project",
    },
  })

  assert.equal(launch, null)
})
