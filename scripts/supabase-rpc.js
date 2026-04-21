const { getSupabaseEnv } = require("./supabase-env.js")

function headers() {
  const { serviceRoleKey } = getSupabaseEnv()
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  }
}

function buildUrl(fn) {
  const { url } = getSupabaseEnv()
  return `${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`
}

async function callRpc(fn, args = {}) {
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
    return null
  }

  return response.json()
}

module.exports = {
  callRpc,
}
