import { spawn } from "child_process"

const DEFAULT_DEV_RUNNER_URL = "http://127.0.0.1:8288"
const DEFAULT_TIMEOUT_MS = 500
const START_COOLDOWN_MS = 15_000

type RunnerState = "online" | "starting" | "offline"
type SpawnedProcess = {
  unref?: () => void
}

type SpawnImpl = (command: string, args: string[], options: {
  cwd: string
  detached: boolean
  env: NodeJS.ProcessEnv
  stdio: "ignore"
}) => SpawnedProcess

let lastStartAttemptAt = 0

export async function isLocalWorkerRunnerAvailable(options?: {
  fetchImpl?: typeof fetch
  url?: string
  timeoutMs?: number
}) {
  const fetchImpl = options?.fetchImpl ?? fetch
  const url = options?.url ?? process.env.INNGEST_DEV_URL ?? DEFAULT_DEV_RUNNER_URL
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    })

    return Boolean(response)
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export function resetLocalWorkerRunnerSupervisorForTests() {
  lastStartAttemptAt = 0
}

export async function ensureLocalWorkerRunner(options?: {
  fetchImpl?: typeof fetch
  spawnImpl?: SpawnImpl
  url?: string
  timeoutMs?: number
  nowMs?: number
  nodeEnv?: string
  inngestEndpoint?: string
}) {
  const runnerAvailable = await isLocalWorkerRunnerAvailable({
    fetchImpl: options?.fetchImpl,
    url: options?.url,
    timeoutMs: options?.timeoutMs,
  })

  if (runnerAvailable) {
    return {
      runnerAvailable: true,
      runnerState: "online" as RunnerState,
    }
  }

  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV
  if (nodeEnv === "production") {
    return {
      runnerAvailable: false,
      runnerState: "offline" as RunnerState,
    }
  }

  const nowMs = options?.nowMs ?? Date.now()
  if (lastStartAttemptAt && nowMs - lastStartAttemptAt < START_COOLDOWN_MS) {
    return {
      runnerAvailable: false,
      runnerState: "starting" as RunnerState,
    }
  }

  lastStartAttemptAt = nowMs
  const spawnImpl = options?.spawnImpl ?? spawn
  const inngestEndpoint =
    options?.inngestEndpoint ??
    process.env.INNGEST_DEV_FUNCTION_URL ??
    "http://127.0.0.1:3010/api/inngest"

  try {
    const child = spawnImpl("npx", ["inngest-cli@latest", "dev", "-u", inngestEndpoint], {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        INNGEST_DEV: "1",
      },
      stdio: "ignore",
    })
    child.unref?.()

    return {
      runnerAvailable: false,
      runnerState: "starting" as RunnerState,
    }
  } catch {
    return {
      runnerAvailable: false,
      runnerState: "offline" as RunnerState,
    }
  }
}
