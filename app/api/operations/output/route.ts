import { NextRequest, NextResponse } from "next/server"
import { getOperationsRunOutput } from "@/lib/operations-run-output"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("runId")?.trim()
  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 })
  }

  return NextResponse.json(await getOperationsRunOutput(runId))
}
