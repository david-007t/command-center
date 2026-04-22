import type { SupabaseArtifactRow } from "@/lib/inngest-run-store"
import { buildOperationsRunOutput, type OperationsRunOutput } from "@/lib/operations-run-output-core"
import { getSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env"

export { buildOperationsRunOutput, type OperationsRunOutput }

async function listRunOutputArtifacts(runId: string, timeoutMs = 900) {
  if (!isSupabaseConfigured()) return []
  const { url, serviceRoleKey } = getSupabaseEnv()
  const params = new URLSearchParams()
  params.set("select", "id,run_id,artifact_type,label,content,metadata,created_at")
  params.set("run_id", `eq.${runId}`)
  params.set("artifact_type", "in.(commentary,execution_log,message_preview)")
  params.set("order", "created_at.asc")

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/artifacts?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
    })
    if (!response.ok) return []
    return (await response.json()) as SupabaseArtifactRow[]
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
}

export async function getOperationsRunOutput(runId: string): Promise<OperationsRunOutput> {
  return buildOperationsRunOutput(runId, await listRunOutputArtifacts(runId))
}
