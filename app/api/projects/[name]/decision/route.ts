import { NextResponse } from "next/server"
import { applyProjectDecision } from "@/lib/project-decision"

export async function POST(
  request: Request,
  { params }: { params: { name: string } },
) {
  const body = (await request.json()) as {
    decision?: string
    note?: string
  }

  const projectName = params.name
  const decision = body.decision?.trim()
  const note = body.note?.trim() ?? ""

  if (!decision) {
    return NextResponse.json({ error: "decision is required." }, { status: 400 })
  }

  try {
    const result = await applyProjectDecision(projectName, decision, note)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : `Unsupported decision for project ${projectName}.`
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
