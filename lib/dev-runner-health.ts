const DEFAULT_DEV_RUNNER_URL = "http://127.0.0.1:8288"
const DEFAULT_TIMEOUT_MS = 500

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
