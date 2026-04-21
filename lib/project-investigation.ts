import { promises as fs } from "fs"
import path from "path"
import type { TrustCheck } from "@/lib/project-trust"

export type InvestigationEvidenceStatus = "confirmed" | "inferred" | "unverified" | "blocked"

export type InvestigationEvidence = {
  label: string
  status: InvestigationEvidenceStatus
  source:
    | "local_repo"
    | "github"
    | "vercel"
    | "governance"
    | "runtime_record"
    | "worker_report"
    | "remediation"
  detail: string
  url?: string
}

export type InvestigationActionStatus = "pending" | "attempted" | "completed" | "skipped" | "blocked"

export type InvestigationAction = {
  kind: string
  status: InvestigationActionStatus
  summary: string
}

export type InvestigationRecord = {
  projectName: string
  generatedAt: string
  status: "healthy" | "needs_attention" | "blocked"
  title: string
  summary: string
  likelyCause: string
  nextStep: string
  diagnosisCode?: string
  recommendedAction?: {
    kind: string
    summary: string
  }
  deploymentDetails?: {
    branch: string
    state: string
    commitSha: string | null
    url: string | null
    createdAt: string | null
  }
  proofSummary?: {
    verified: string[]
    inferred: string[]
    blocked: string[]
  }
  canAutofix: boolean
  suggestedInstruction: string
  checks: string[]
  evidence: InvestigationEvidence[]
  actions: InvestigationAction[]
  trustChecks: TrustCheck[]
}

export function getInvestigationFilePath(developerPath: string, projectName: string) {
  return path.join(developerPath, "_system", "runtime", "investigations", `${projectName}.json`)
}

export async function readInvestigationRecord(developerPath: string, projectName: string) {
  const filePath = getInvestigationFilePath(developerPath, projectName)
  const raw = await fs.readFile(filePath, "utf8").catch(() => "")
  return raw ? (JSON.parse(raw) as InvestigationRecord) : null
}
