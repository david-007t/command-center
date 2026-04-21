import test from "node:test"
import assert from "node:assert/strict"
import { isLocalWorkerRunnerAvailable } from "./dev-runner-health.ts"

test("isLocalWorkerRunnerAvailable returns true when the dev runner responds", async () => {
  const available = await isLocalWorkerRunnerAvailable({
    fetchImpl: async () => new Response("ok", { status: 200 }),
    url: "http://127.0.0.1:9999",
  })

  assert.equal(available, true)
})

test("isLocalWorkerRunnerAvailable returns false when the dev runner probe fails", async () => {
  const available = await isLocalWorkerRunnerAvailable({
    fetchImpl: async () => {
      throw new Error("connect failed")
    },
    url: "http://127.0.0.1:9999",
  })

  assert.equal(available, false)
})
