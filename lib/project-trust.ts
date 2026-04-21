export type TrustCheck = {
  label: string
  status: "confirmed" | "inferred" | "unverified"
  source: "local_repo" | "worker_report" | "governance" | "external_deploy" | "runtime_record"
  detail: string
}

export type TrustSummary = {
  level: "confirmed" | "inferred" | "unverified"
  headline: string
  checks: TrustCheck[]
}

export function summarizeTrustChecks(checks: TrustCheck[]): TrustSummary {
  if (checks.some((check) => check.status === "unverified")) {
    return {
      level: "unverified",
      headline: "Some important claims are not yet verified by evidence.",
      checks,
    }
  }

  if (checks.some((check) => check.status === "inferred")) {
    return {
      level: "inferred",
      headline: "The latest state is partly based on worker-reported evidence.",
      checks,
    }
  }

  return {
    level: "confirmed",
    headline: "The latest state is backed by verified evidence.",
    checks,
  }
}
