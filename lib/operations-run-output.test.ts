import test from "node:test"
import assert from "node:assert/strict"
import { buildOperationsRunOutput } from "./operations-run-output-core.ts"
import type { SupabaseArtifactRow } from "./inngest-run-store.ts"

function artifact(overrides: Partial<SupabaseArtifactRow>): SupabaseArtifactRow {
  return {
    id: "artifact-1",
    run_id: "run-1",
    artifact_type: "commentary",
    label: "Commentary",
    content: "",
    metadata: {},
    created_at: "2026-04-22T07:20:00.000Z",
    ...overrides,
  }
}

test("buildOperationsRunOutput prefers the latest commentary artifact", () => {
  const result = buildOperationsRunOutput("run-1", [
    artifact({
      id: "old",
      content: "old commentary",
      created_at: "2026-04-22T07:19:00.000Z",
    }),
    artifact({
      id: "new",
      content: "line one\nline two",
      created_at: "2026-04-22T07:21:00.000Z",
    }),
    artifact({
      id: "log",
      artifact_type: "execution_log",
      content: "log output",
      created_at: "2026-04-22T07:22:00.000Z",
    }),
  ])

  assert.equal(result.source, "commentary")
  assert.equal(result.output, "line one\nline two")
  assert.equal(result.updatedAt, "2026-04-22T07:21:00.000Z")
})

test("buildOperationsRunOutput falls back to execution log and trims to the latest lines", () => {
  const result = buildOperationsRunOutput(
    "run-1",
    [
      artifact({
        artifact_type: "execution_log",
        content: "one\ntwo\nthree\nfour",
        created_at: "2026-04-22T07:21:00.000Z",
      }),
    ],
    2,
  )

  assert.equal(result.source, "execution_log")
  assert.equal(result.output, "three\nfour")
})
