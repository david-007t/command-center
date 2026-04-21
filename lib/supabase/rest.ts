import { getSupabaseEnv } from "./env"

type Primitive = string | number | boolean

function headers(prefer?: string) {
  const { serviceRoleKey } = getSupabaseEnv()
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  }
}

function buildUrl(table: string, params?: URLSearchParams) {
  const { url } = getSupabaseEnv()
  const query = params?.toString()
  return `${url.replace(/\/$/, "")}/rest/v1/${table}${query ? `?${query}` : ""}`
}

async function request<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Supabase request failed (${response.status}): ${body || response.statusText}`)
  }

  if (response.status === 204) {
    return null as T
  }

  return (await response.json()) as T
}

export async function selectRows<T>(
  table: string,
  {
    select = "*",
    filters,
    order,
    limit,
  }: {
    select?: string
    filters?: Record<string, Primitive | null | undefined>
    order?: string
    limit?: number
  } = {},
) {
  const params = new URLSearchParams()
  params.set("select", select)

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined) continue
      params.set(key, value === null ? "is.null" : `eq.${String(value)}`)
    }
  }

  if (order) params.set("order", order)
  if (typeof limit === "number") params.set("limit", String(limit))

  return request<T[]>(buildUrl(table, params), {
    headers: headers(),
  })
}

export async function upsertRows<T>(table: string, rows: unknown[], onConflict: string) {
  const params = new URLSearchParams()
  params.set("on_conflict", onConflict)

  return request<T[]>(buildUrl(table, params), {
    method: "POST",
    headers: headers("resolution=merge-duplicates,return=representation"),
    body: JSON.stringify(rows),
  })
}

export async function insertRows<T>(table: string, rows: unknown[]) {
  return request<T[]>(buildUrl(table), {
    method: "POST",
    headers: headers("return=representation"),
    body: JSON.stringify(rows),
  })
}

export async function deleteRows(table: string, filters: Record<string, Primitive | null | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue
    params.set(key, value === null ? "is.null" : `eq.${String(value)}`)
  }

  return request<null>(buildUrl(table, params), {
    method: "DELETE",
    headers: headers(),
  })
}

export async function updateRows<T>(
  table: string,
  rows: unknown,
  filters: Record<string, Primitive | null | undefined>,
) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue
    params.set(key, value === null ? "is.null" : `eq.${String(value)}`)
  }

  return request<T[]>(buildUrl(table, params), {
    method: "PATCH",
    headers: headers("return=representation"),
    body: JSON.stringify(rows),
  })
}
