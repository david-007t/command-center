function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase runtime store is not configured.")
  }

  return {
    url,
    serviceRoleKey,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  }
}

module.exports = {
  isSupabaseConfigured,
  getSupabaseEnv,
}
