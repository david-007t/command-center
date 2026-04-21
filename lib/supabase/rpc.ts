import { getSupabaseEnv } from "./env"

function headers() {
  const { serviceRoleKey } = getSupabaseEnv()
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  }
}

function buildUrl(fn: string) {
  const { url } = getSupabaseEnv()
  return `${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`
}

export async function callRpc<T>(fn: string, args: Record<string, unknown> = {}) {
  const response = await fetch(buildUrl(fn), {
    method: "POST",
    headers: headers(),
    cache: "no-store",
    body: JSON.stringify(args),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Supabase RPC failed (${response.status}): ${body || response.statusText}`)
  }

  if (response.status === 204) {
    return null as T
  }

  return (await response.json()) as T
}
