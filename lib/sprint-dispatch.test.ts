import test from "node:test"
import assert from "node:assert/strict"
import { chooseProjectRunTemplate } from "./sprint-dispatch.ts"

test("chooseProjectRunTemplate prefers continue_project when generic work asks have sprint priority", () => {
  const template = chooseProjectRunTemplate({
    instruction: "keep going on this project",
    hasPriorityTask: true,
    runtimeStatus: "blocked",
  })

  assert.equal(template, "continue_project")
})

test("chooseProjectRunTemplate still honors explicit investigation requests", () => {
  const template = chooseProjectRunTemplate({
    instruction: "investigate why the preview deploy is broken",
    hasPriorityTask: true,
    runtimeStatus: "healthy",
  })

  assert.equal(template, "investigate_issue")
})
