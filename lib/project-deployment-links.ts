import type { VercelDeploymentLink, VercelDeploymentLinks } from "./vercel-deployments"

export type ProjectDeploymentLinkSource = VercelDeploymentLink["source"]

const URL_PATTERN = /\bhttps?:\/\/[^\s<>()"'`]+/gi

function normalizeUrl(raw: string) {
  const trimmed = raw.trim().replace(/[),.;\]]+$/g, "")
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    url.hash = ""
    if (url.pathname === "/") url.pathname = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

function isLikelyProductUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return true
    return parsed.hostname.includes(".")
  } catch {
    return false
  }
}

function inferEnvironment(url: string): "production" | "stage" {
  const normalized = url.toLowerCase()
  return /(?:^|[-.])(stage|staging|preview)(?:[-.]|$)|-git-stage[.-]/.test(normalized) ? "stage" : "production"
}

export function extractDeploymentUrls(text: string | null | undefined) {
  if (!text) return []

  const seen = new Set<string>()
  const urls: string[] = []
  for (const match of text.matchAll(URL_PATTERN)) {
    const normalized = normalizeUrl(match[0])
    if (!normalized || !isLikelyProductUrl(normalized) || seen.has(normalized)) continue
    seen.add(normalized)
    urls.push(normalized)
  }

  return urls
}

export function projectLinkFromUrl(
  url: string,
  source: ProjectDeploymentLinkSource,
  environment: "production" | "stage" = inferEnvironment(url),
): VercelDeploymentLink {
  return {
    label: environment === "production" ? "Production" : "Stage",
    environment,
    url,
    state: "observed",
    source,
    createdAt: null,
  }
}

function sameLink(left: VercelDeploymentLink | null, right: VercelDeploymentLink | null) {
  if (!left && !right) return true
  if (!left || !right) return false
  return (
    left.label === right.label &&
    left.environment === right.environment &&
    left.url === right.url &&
    left.state === right.state &&
    left.source === right.source &&
    left.createdAt === right.createdAt
  )
}

export function deploymentLinksEqual(left: VercelDeploymentLinks, right: VercelDeploymentLinks) {
  return sameLink(left.production, right.production) && sameLink(left.stage, right.stage)
}

export function mergeProjectDeploymentLinks({
  existing,
  resolved,
  workerText,
  investigationUrl,
}: {
  existing?: VercelDeploymentLinks | null
  resolved?: VercelDeploymentLinks | null
  workerText?: Array<string | null | undefined>
  investigationUrl?: string | null
}): VercelDeploymentLinks {
  const links: VercelDeploymentLinks = {
    production: resolved?.production ?? existing?.production ?? null,
    stage: resolved?.stage ?? existing?.stage ?? null,
  }

  for (const url of (workerText ?? []).flatMap((text) => extractDeploymentUrls(text))) {
    const environment = inferEnvironment(url)
    if (environment === "stage") {
      links.stage ??= projectLinkFromUrl(url, "worker", "stage")
    } else {
      links.production ??= projectLinkFromUrl(url, "worker", "production")
    }
  }

  for (const url of extractDeploymentUrls(investigationUrl)) {
    const environment = inferEnvironment(url)
    if (environment === "stage") {
      links.stage ??= projectLinkFromUrl(url, "investigation", "stage")
    } else {
      links.production ??= projectLinkFromUrl(url, "investigation", "production")
    }
  }

  return links
}
