import test from "node:test"
import assert from "node:assert/strict"
import { buildRunActivityView } from "./run-activity-view.ts"

test("buildRunActivityView says idle when no worker is active", () => {
  const view = buildRunActivityView(null, true)

  assert.equal(view.heading, "Agent is idle")
  assert.match(view.body, /No active worker/i)
  assert.equal(view.live, false)
})

test("buildRunActivityView keeps active commentary explicitly live", () => {
  const view = buildRunActivityView({ status: "running", commentaryPreview: "Using Read.\nInspecting code." }, true)

  assert.equal(view.heading, "Agent is doing now")
  assert.match(view.body, /Using Read/)
  assert.equal(view.live, true)
  assert.equal(view.showPreformatted, true)
})

test("buildRunActivityView is clear when active worker has no detailed activity yet", () => {
  const view = buildRunActivityView({ status: "running", commentaryPreview: "" }, true)

  assert.equal(view.heading, "Agent is doing now")
  assert.match(view.body, /has not reported detailed activity/i)
  assert.equal(view.live, true)
  assert.equal(view.showPreformatted, false)
})

test("buildRunActivityView labels finished commentary as not live", () => {
  const view = buildRunActivityView({ status: "cancelled", commentaryPreview: "Using Grep." }, true)

  assert.equal(view.heading, "Last captured agent activity")
  assert.match(view.detail, /Not live/i)
  assert.equal(view.live, false)
})
