import { NextResponse } from "next/server"
import { deriveInvestigationAutonomy } from "@/lib/command-center-guardrails"
import { ensureProjectContextPack } from "@/lib/project-context-pack"
import { getProjectStatus } from "@/lib/project-status"
import { readProjectStatusFromStore } from "@/lib/runtime-store/phase1-store"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { summarizeUsage } from "@/lib/usage-telemetry"

export async function GET(
  _request: Request,
  { params }: { params: { name: string } },
) {
  if (isSupabaseConfigured()) {
    const stored = await readProjectStatusFromStore(params.name).catch(() => null)
    if (stored) {
      return NextResponse.json(stored)
    }
  }

  const developerPath = process.env.DEVELOPER_PATH
  const projectStatus = await getProjectStatus(params.name)

  if (!developerPath || !projectStatus.investigation) {
    return NextResponse.json(projectStatus)
  }

  const [contextPack, usageSummary] = await Promise.all([
    ensureProjectContextPack(developerPath, params.name).catch(() => null),
    summarizeUsage(developerPath).catch(() => null),
  ])
  const autonomy = deriveInvestigationAutonomy({
    canAutofix: projectStatus.investigation.canAutofix,
    contextHealth: contextPack?.health ?? null,
    usageStatus: usageSummary?.guardrails.overallStatus ?? null,
  })

  return NextResponse.json({
    ...projectStatus,
    investigation: {
      ...projectStatus.investigation,
      autonomyMode: autonomy.mode,
      autonomyRationale: autonomy.rationale,
    },
  })
}
