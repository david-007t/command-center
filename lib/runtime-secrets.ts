import { callRpc } from "@/lib/supabase/rpc"
import { isSupabaseConfigured } from "@/lib/supabase/env"

type SecretResolver = (name: string) => Promise<string | null>

const cache = new Map<string, string | null>()

export const WORKER_SECRET_NAMES = ["ANTHROPIC_API_KEY", "VERCEL_TOKEN"] as const

function normalizeFallbackValue(baseEnv: NodeJS.ProcessEnv, names: string[]) {
  for (const name of names) {
    const value = baseEnv[name]
    if (value != null && value !== "") return value
  }
  return null
}

async function readVaultSecret(name: string) {
  if (!isSupabaseConfigured()) return null
  if (cache.has(name)) return cache.get(name) ?? null

  const value = await callRpc<string | null>("get_runtime_secret", {
    secret_name: name,
  }).catch(() => null)

  cache.set(name, value ?? null)
  return value ?? null
}

export async function resolveRuntimeSecret(params: {
  primaryName: string
  fallbackNames?: string[]
  baseEnv?: NodeJS.ProcessEnv
  resolver?: SecretResolver
}) {
  const fallbackNames = params.fallbackNames ?? []
  const baseEnv = params.baseEnv ?? process.env
  const fromEnv = normalizeFallbackValue(baseEnv, [params.primaryName, ...fallbackNames])
  if (fromEnv) return fromEnv

  const resolver = params.resolver ?? readVaultSecret
  const fromVault = await resolver(params.primaryName)
  if (fromVault != null && fromVault !== "") return fromVault

  return null
}

export async function resolveWorkerSecrets(baseEnv: NodeJS.ProcessEnv = process.env, resolver?: SecretResolver) {
  const [anthropic, vercel] = await Promise.all([
    resolveRuntimeSecret({
      primaryName: "ANTHROPIC_API_KEY",
      baseEnv,
      resolver,
    }),
    resolveRuntimeSecret({
      primaryName: "VERCEL_TOKEN",
      fallbackNames: ["VERCEL_API_TOKEN", "VERCEL_AUTH_TOKEN"],
      baseEnv,
      resolver,
    }),
  ])

  return {
    ANTHROPIC_API_KEY: anthropic,
    VERCEL_TOKEN: vercel,
    VERCEL_API_TOKEN: vercel,
    VERCEL_AUTH_TOKEN: vercel,
  }
}

export function resetRuntimeSecretCache() {
  cache.clear()
}
