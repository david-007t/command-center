import test from "node:test"
import assert from "node:assert/strict"
import { ensureLocalWorkerRunner, isLocalWorkerRunnerAvailable, resetLocalWorkerRunnerSupervisorForTests } from "./dev-runner-health.ts"

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

test("ensureLocalWorkerRunner reports online without spawning when the runner is already available", async () => {
  resetLocalWorkerRunnerSupervisorForTests()
  let spawnCount = 0

  const result = await ensureLocalWorkerRunner({
    fetchImpl: async () => new Response("ok", { status: 200 }),
    spawnImpl: () => {
      spawnCount += 1
      return { unref() {} }
    },
    nodeEnv: "development",
    inngestEndpoint: "http://127.0.0.1:3010/api/inngest",
  })

  assert.equal(result.runnerAvailable, true)
  assert.equal(result.runnerState, "online")
  assert.equal(spawnCount, 0)
})

test("ensureLocalWorkerRunner starts the local dev runner when offline", async () => {
  resetLocalWorkerRunnerSupervisorForTests()
  let spawnArgs: { command: string; args: string[] } | null = null

  const result = await ensureLocalWorkerRunner({
    fetchImpl: async () => {
      throw new Error("offline")
    },
    spawnImpl: (command, args) => {
      spawnArgs = { command, args }
      return { unref() {} }
    },
    nodeEnv: "development",
    inngestEndpoint: "http://127.0.0.1:3010/api/inngest",
  })

  assert.equal(result.runnerAvailable, false)
  assert.equal(result.runnerState, "starting")
  assert.equal(spawnArgs?.command, "npx")
  assert.deepEqual(spawnArgs?.args, ["inngest-cli@latest", "dev", "-u", "http://127.0.0.1:3010/api/inngest"])
})

test("ensureLocalWorkerRunner does not spawn from production", async () => {
  resetLocalWorkerRunnerSupervisorForTests()
  let spawnCount = 0

  const result = await ensureLocalWorkerRunner({
    fetchImpl: async () => {
      throw new Error("offline")
    },
    spawnImpl: () => {
      spawnCount += 1
      return { unref() {} }
    },
    nodeEnv: "production",
    inngestEndpoint: "http://127.0.0.1:3010/api/inngest",
  })

  assert.equal(result.runnerAvailable, false)
  assert.equal(result.runnerState, "offline")
  assert.equal(spawnCount, 0)
})
