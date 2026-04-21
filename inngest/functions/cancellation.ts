import { readInngestManagedRun, updateRunRecord } from "@/lib/inngest-run-store"

export class ManagedRunCancelledError extends Error {
  constructor(message = "Run was cancelled by the operator.") {
    super(message)
    this.name = "ManagedRunCancelledError"
  }
}

export async function isCancellationRequested(runId: string) {
  const run = await readInngestManagedRun(runId)
  if (!run) return false

  const metadata = (run.metadata ?? {}) as Record<string, unknown>
  return run.status === "cancelled" || Boolean(metadata.cancelRequestedAt)
}

export async function throwIfCancellationRequested(runId: string) {
  if (await isCancellationRequested(runId)) {
    throw new ManagedRunCancelledError()
  }
}

export async function setActiveProcessPid(runId: string, pid: number | null) {
  await updateRunRecord(runId, {
    metadata: {
      activeProcessPid: pid,
    },
  })
}

export async function clearActiveProcessPid(runId: string) {
  const run = await readInngestManagedRun(runId)
  if (!run) return

  const metadata = (run.metadata ?? {}) as Record<string, unknown>
  if (run.status !== "queued" && run.status !== "running") return
  if (metadata.cancelRequestedAt) return

  await updateRunRecord(runId, {
    metadata: {
      activeProcessPid: null,
    },
  })
}
