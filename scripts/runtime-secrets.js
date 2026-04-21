const { isSupabaseConfigured } = require("./supabase-env.js")
const { callRpc } = require("./supabase-rpc.js")

const cache = new Map()

function normalizeFallbackValue(baseEnv, names) {
  for (const name of names) {
    const value = baseEnv[name]
    if (value != null && value !== "") return value
  }
  return null
}

async function readVaultSecret(name) {
  if (!isSupabaseConfigured()) return null
  if (cache.has(name)) return cache.get(name) ?? null

  const value = await callRpc("get_runtime_secret", {
    secret_name: name,
  }).catch(() => null)

  cache.set(name, value ?? null)
  return value ?? null
}

async function resolveRuntimeSecret({ primaryName, fallbackNames = [], baseEnv = process.env, resolver = readVaultSecret }) {
  const fromEnv = normalizeFallbackValue(baseEnv, [primaryName, ...fallbackNames])
  if (fromEnv) return fromEnv

  const fromVault = await resolver(primaryName)
  if (fromVault != null && fromVault !== "") return fromVault

  return null
}

async function resolveWorkerSecrets(baseEnv = process.env, resolver = readVaultSecret) {
  const anthropic = await resolveRuntimeSecret({
    primaryName: "ANTHROPIC_API_KEY",
    baseEnv,
    resolver,
  })
  const vercel = await resolveRuntimeSecret({
    primaryName: "VERCEL_TOKEN",
    fallbackNames: ["VERCEL_API_TOKEN", "VERCEL_AUTH_TOKEN"],
    baseEnv,
    resolver,
  })

  return {
    ANTHROPIC_API_KEY: anthropic,
    VERCEL_TOKEN: vercel,
    VERCEL_API_TOKEN: vercel,
    VERCEL_AUTH_TOKEN: vercel,
  }
}

function resetRuntimeSecretCache() {
  cache.clear()
}

module.exports = {
  resolveRuntimeSecret,
  resolveWorkerSecrets,
  resetRuntimeSecretCache,
}
