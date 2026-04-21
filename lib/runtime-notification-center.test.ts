import test from "node:test"
import assert from "node:assert/strict"
import { buildRuntimeNotification, mergeRuntimeNotifications, shouldSuppressRuntimeNotification } from "./runtime-notification-center.ts"
import type { RuntimeMutationEvent } from "./runtime-event-types.ts"

function makeEvent(overrides: Partial<RuntimeMutationEvent> = {}): RuntimeMutationEvent {
  return {
    projectName: "leadqual",
    scope: "project",
    reason: "job_update",
    timestamp: Date.now(),
    eventType: "run_stage_changed",
    title: "leadqual - executing in progress",
    body: "Executing the assignment.",
    chatThreadId: "thread-1",
    jobId: "job-1",
    status: "running",
    currentStage: "executing",
    ...overrides,
  }
}

test("buildRuntimeNotification maps a runtime event into a global notification", () => {
  const notification = buildRuntimeNotification(makeEvent({ timestamp: 1000 }))

  assert.equal(notification.id, "job-1:run_stage_changed:running:executing")
  assert.equal(notification.projectName, "leadqual")
  assert.equal(notification.title, "leadqual - executing in progress")
  assert.equal(notification.message, "Executing the assignment.")
  assert.equal(notification.timestamp, 1000)
  assert.equal(notification.eventType, "run_stage_changed")
  assert.equal(notification.reason, "job_update")
  assert.equal(notification.chatThreadId, "thread-1")
})

test("mergeRuntimeNotifications deduplicates repeated updates for the same lifecycle point", () => {
  const first = buildRuntimeNotification(makeEvent({ timestamp: 1000 }))
  const duplicate = buildRuntimeNotification(makeEvent({ timestamp: 2000 }))

  const merged = mergeRuntimeNotifications([first], duplicate)

  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.timestamp, 2000)
})

test("mergeRuntimeNotifications keeps only the newest notifications", () => {
  let queue = [] as ReturnType<typeof mergeRuntimeNotifications>

  for (let index = 0; index < 7; index += 1) {
    queue = mergeRuntimeNotifications(
      queue,
      buildRuntimeNotification(
        makeEvent({
          timestamp: index,
          jobId: `job-${index}`,
          currentStage: `stage-${index}`,
          title: `Update ${index}`,
        }),
      ),
    )
  }

  assert.equal(queue.length, 5)
  assert.equal(queue[0]?.jobId, "job-6")
  assert.equal(queue.at(-1)?.jobId, "job-2")
})

test("shouldSuppressRuntimeNotification hides same-project updates while viewing that project's chat", () => {
  const notification = buildRuntimeNotification(makeEvent({ projectName: "leadqual" }))
  const chatRefreshNotification = buildRuntimeNotification(
    makeEvent({
      projectName: "leadqual",
      eventType: "message_created",
      reason: "refresh",
      title: "Chat thread updated",
    }),
  )

  assert.equal(shouldSuppressRuntimeNotification("/projects/leadqual/chat", notification), true)
  assert.equal(shouldSuppressRuntimeNotification("/projects/LeadQual/chat", notification), true)
  assert.equal(shouldSuppressRuntimeNotification("/projects/leadqual/chat", chatRefreshNotification), true)
  assert.equal(
    shouldSuppressRuntimeNotification(
      "/projects/leadqual/chat",
      buildRuntimeNotification(
        makeEvent({
          projectName: null,
          eventType: "project_runtime_updated",
          reason: "refresh",
          title: "System - planning in progress",
        }),
      ),
    ),
    true,
  )
  assert.equal(shouldSuppressRuntimeNotification("/projects/rbc/chat", notification), false)
  assert.equal(shouldSuppressRuntimeNotification("/projects/leadqual/work", notification), false)
})
