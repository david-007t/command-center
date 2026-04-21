import test from "node:test"
import assert from "node:assert/strict"

import {
  assertEvidenceBeforeDone,
  mapSupabaseRunToRuntimeJob,
  supabaseArtifactPath,
  type SupabaseArtifactRow,
  type SupabaseRunRow,
} from "./inngest-run-presentation.ts"

const baseRun: SupabaseRunRow = {
  id: "run-123",
  project_id: "project-1",
  thread_id: "thread-1",
  run_template: "continue_project",
  instruction: "Continue leadqual",
  status: "running",
  current_stage: "executing",
  summary: "Executing",
  created_at: "2026-04-16T00:00:00.000Z",
  started_at: "2026-04-16T00:01:00.000Z",
  completed_at: null,
  metadata: {
    projectName: "leadqual",
    chatThreadId: "chat-1",
    engine: "inngest",
  },
}

test("mapSupabaseRunToRuntimeJob preserves the existing UI shape without local file paths", () => {
  const artifacts: SupabaseArtifactRow[] = [
    {
      id: "artifact-1",
      run_id: "run-123",
      artifact_type: "message_preview",
      label: "Final message",
      content: "Outcome\nVerification",
      metadata: {},
      created_at: "2026-04-16T00:02:00.000Z",
    },
    {
      id: "artifact-2",
      run_id: "run-123",
      artifact_type: "commentary",
      label: "Live notes",
      content: "What I checked",
      metadata: {},
      created_at: "2026-04-16T00:01:30.000Z",
    },
  ]

  const mapped = mapSupabaseRunToRuntimeJob(baseRun, artifacts)

  assert.equal(mapped.id, "run-123")
  assert.equal(mapped.projectName, "leadqual")
  assert.equal(mapped.chatThreadId, "chat-1")
  assert.equal(mapped.status, "running")
  assert.equal(mapped.currentStage, "executing")
  assert.equal(mapped.messagePath, supabaseArtifactPath("run-123", "message_preview"))
  assert.equal(mapped.commentaryPath, supabaseArtifactPath("run-123", "commentary"))
  assert.equal(mapped.logPath, supabaseArtifactPath("run-123", "execution_log"))
  assert.equal(mapped.workingDirectory, "inngest://leadqual/run-123")
  assert.equal(mapped.summary, "Executing")
})

test("assertEvidenceBeforeDone rejects done transitions without stored evidence", () => {
  assert.throws(
    () =>
      assertEvidenceBeforeDone({
        run: {
          ...baseRun,
          status: "completed",
          current_stage: "done",
        },
        artifacts: [],
      }),
    /evidence/i,
  )
})

test("assertEvidenceBeforeDone accepts done transitions once evidence exists", () => {
  const artifacts: SupabaseArtifactRow[] = [
    {
      id: "artifact-3",
      run_id: "run-123",
      artifact_type: "verification",
      label: "Verification",
      content: "Verified with concrete inspection.",
      metadata: {},
      created_at: "2026-04-16T00:03:00.000Z",
    },
  ]

  assert.doesNotThrow(() =>
    assertEvidenceBeforeDone({
      run: {
        ...baseRun,
        status: "completed",
        current_stage: "done",
      },
      artifacts,
    }),
  )
})

test("mapSupabaseRunToRuntimeJob preserves orchestrator runs as system-scoped jobs", () => {
  const mapped = mapSupabaseRunToRuntimeJob({
    ...baseRun,
    run_template: null,
    metadata: {
      engine: "inngest",
      jobType: "orchestrator_run",
      projectName: null,
      workingDirectory: "/Users/ohsay22/Developer/_system/orchestrator",
    },
  })

  assert.equal(mapped.type, "orchestrator_run")
  assert.equal(mapped.projectName, null)
  assert.equal(mapped.workingDirectory, "/Users/ohsay22/Developer/_system/orchestrator")
})
