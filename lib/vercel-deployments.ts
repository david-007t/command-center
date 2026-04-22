import { promises as fs } from "fs"
import path from "path"

type Env = Record<string, string | undefined>
type FetchImpl = typeof fetch

export type VercelProjectRef = {
  projectId: string
  teamId: string | null
}

export type VercelDeploymentLink = {
  label: "Production" | "Stage"
  environment: "production" | "stage"
  url: string
  state: string
  source: "vercel" | "config" | "worker" | "investigation" | "local"
  createdAt: string | null
}

export type VercelDeploymentLinks = {
  production: VercelDeploymentLink | null
  stage: VercelDeploymentLink | null
}

type ResolverOptions = {
  projectName: string
  projectDir: string
  env?: Env
  fetchImpl?: FetchImpl
}

type VercelProject = {
  id?: string
  name?: string
  accountId?: string
  gitRepository?: {
    repo?: string
  }
}

type VercelDeployment = {
  uid?: string
  state?: string
  target?: string
  url?: string
  alias?: string[]
  aliases?: string[]
  createdAt?: number
  created?: number
  meta?: {
    githubCommitRef?: string
    branchAlias?: string
  }
}

type VercelDomain = {
  name?: string
  verified?: boolean
}

function projectEnvKey(projectName: string, prefix: string) {
  const key = projectName.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase()
  return `${prefix}_${key}`
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function tokenFromEnv(env: Env) {
  return env.VERCEL_TOKEN || env.VERCEL_API_TOKEN || env.VERCEL_AUTH_TOKEN || null
}

function teamIdFromEnv(env: Env) {
  return env.VERCEL_TEAM_ID || env.VERCEL_ORG_ID || null
}

function stageBranchFromEnv(projectName: string, env: Env) {
  return env[projectEnvKey(projectName, "VERCEL_STAGE_BRANCH")] || env.VERCEL_STAGE_BRANCH || "stage"
}

function normalizeConfiguredUrl(raw: string | undefined) {
  if (!raw) return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    url.hash = ""
    if (url.pathname === "/") url.pathname = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

function configuredLink(projectName: string, env: Env, environment: "production" | "stage") {
  const raw =
    environment === "production"
      ? env[projectEnvKey(projectName, "VERCEL_PRODUCT_URL")] ||
        env[projectEnvKey(projectName, "PRODUCT_URL")] ||
        env.VERCEL_PRODUCT_URL ||
        env.PRODUCT_URL
      : env[projectEnvKey(projectName, "VERCEL_STAGE_URL")] ||
        env[projectEnvKey(projectName, "STAGE_URL")] ||
        env.VERCEL_STAGE_URL ||
        env.STAGE_URL
  const url = normalizeConfiguredUrl(raw)
  return url
    ? {
        label: environment === "production" ? "Production" as const : "Stage" as const,
        environment,
        url,
        state: "configured",
        source: "config" as const,
        createdAt: null,
      }
    : null
}

async function readLinkedProject(projectDir: string): Promise<VercelProjectRef | null> {
  const raw = await fs.readFile(path.join(projectDir, ".vercel", "project.json"), "utf8").catch(() => "")
  if (!raw) return null

  const parsed = JSON.parse(raw) as { projectId?: string; orgId?: string }
  if (!parsed.projectId) return null

  return {
    projectId: parsed.projectId,
    teamId: parsed.orgId ?? null,
  }
}

function envProjectRef(projectName: string, env: Env): VercelProjectRef | null {
  const projectId = env[projectEnvKey(projectName, "VERCEL_PROJECT_ID")]
  if (!projectId) return null

  return {
    projectId,
    teamId: env[projectEnvKey(projectName, "VERCEL_TEAM_ID")] || teamIdFromEnv(env),
  }
}

async function discoverProjectRef(projectName: string, env: Env, fetchImpl: FetchImpl): Promise<VercelProjectRef | null> {
  const token = tokenFromEnv(env)
  if (!token) return null

  const projectNameOverride = env[projectEnvKey(projectName, "VERCEL_PROJECT_NAME")]
  const teamId = teamIdFromEnv(env)
  const url = new URL("https://api.vercel.com/v9/projects")
  if (teamId) url.searchParams.set("teamId", teamId)

  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return null

  const body = (await response.json()) as { projects?: VercelProject[] }
  const projects = body.projects ?? []
  const wanted = normalize(projectNameOverride || projectName)
  const match = projects.find((project) => {
    const name = normalize(project.name ?? "")
    const repo = normalize(project.gitRepository?.repo ?? "")
    return name === wanted || name.includes(wanted) || wanted.includes(name) || repo.includes(wanted)
  })

  if (!match?.id) return null

  return {
    projectId: match.id,
    teamId: teamId || match.accountId || null,
  }
}

export async function getVercelProjectRef(options: ResolverOptions): Promise<VercelProjectRef | null> {
  const env = options.env ?? process.env
  const fetchImpl = options.fetchImpl ?? fetch

  return envProjectRef(options.projectName, env) ?? (await readLinkedProject(options.projectDir)) ?? (await discoverProjectRef(options.projectName, env, fetchImpl))
}

function deploymentUrl(deployment: VercelDeployment) {
  const alias = deployment.alias?.[0] || deployment.aliases?.[0]
  const value = alias || deployment.url
  if (!value) return null
  return value.startsWith("http") ? value : `https://${value}`
}

function createdAt(deployment: VercelDeployment) {
  const timestamp = deployment.createdAt ?? deployment.created
  return timestamp ? new Date(timestamp).toISOString() : null
}

async function listDeployments({
  projectRef,
  token,
  target,
  fetchImpl,
}: {
  projectRef: VercelProjectRef
  token: string
  target: "production" | "preview"
  fetchImpl: FetchImpl
}) {
  const url = new URL("https://api.vercel.com/v6/deployments")
  url.searchParams.set("projectId", projectRef.projectId)
  url.searchParams.set("limit", "20")
  url.searchParams.set("target", target)
  if (projectRef.teamId) url.searchParams.set("teamId", projectRef.teamId)

  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return [] as VercelDeployment[]

  const body = (await response.json()) as { deployments?: VercelDeployment[] }
  return body.deployments ?? []
}

async function getProductionDomain(projectRef: VercelProjectRef, token: string, fetchImpl: FetchImpl) {
  const url = new URL(`https://api.vercel.com/v9/projects/${projectRef.projectId}/domains`)
  if (projectRef.teamId) url.searchParams.set("teamId", projectRef.teamId)

  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return null

  const body = (await response.json()) as { domains?: VercelDomain[] }
  const domain = (body.domains ?? []).find((item) => item.verified && item.name) ?? (body.domains ?? []).find((item) => item.name)
  if (!domain?.name) return null

  return domain.name.startsWith("http") ? domain.name : `https://${domain.name}`
}

function pickReadyDeployment(deployments: VercelDeployment[], branch?: string) {
  const filtered = branch
    ? deployments.filter((deployment) => deployment.meta?.githubCommitRef === branch || deployment.meta?.branchAlias?.includes(`-git-${branch}-`))
    : deployments

  return filtered.find((deployment) => deployment.state === "READY") ?? filtered[0] ?? null
}

async function resolveDeploymentLink({
  projectRef,
  token,
  fetchImpl,
  environment,
  branch,
}: {
  projectRef: VercelProjectRef
  token: string
  fetchImpl: FetchImpl
  environment: "production" | "stage"
  branch?: string
}): Promise<VercelDeploymentLink | null> {
  const deployments = await listDeployments({
    projectRef,
    token,
    target: environment === "production" ? "production" : "preview",
    fetchImpl,
  })
  const deployment = pickReadyDeployment(deployments, branch)
  if (!deployment) return null

  const url = deploymentUrl(deployment)
  if (!url) return null
  const productionDomain = environment === "production" ? await getProductionDomain(projectRef, token, fetchImpl).catch(() => null) : null

  return {
    label: environment === "production" ? "Production" : "Stage",
    environment,
    url: productionDomain ?? url,
    state: deployment.state || "unknown",
    source: "vercel",
    createdAt: createdAt(deployment),
  }
}

export async function getVercelDeploymentLinks(options: ResolverOptions): Promise<VercelDeploymentLinks> {
  const env = options.env ?? process.env
  const fetchImpl = options.fetchImpl ?? fetch
  const configured = {
    production: configuredLink(options.projectName, env, "production"),
    stage: configuredLink(options.projectName, env, "stage"),
  }
  const token = tokenFromEnv(env)
  if (!token) return configured

  const projectRef = await getVercelProjectRef({ ...options, env, fetchImpl })
  if (!projectRef) return configured

  const [production, stage] = await Promise.all([
    resolveDeploymentLink({ projectRef, token, fetchImpl, environment: "production" }),
    resolveDeploymentLink({ projectRef, token, fetchImpl, environment: "stage", branch: stageBranchFromEnv(options.projectName, env) }),
  ])

  return {
    production: configured.production ?? production,
    stage: configured.stage ?? stage,
  }
}
