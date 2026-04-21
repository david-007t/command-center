import { promises as fs } from "fs"
import path from "path"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const developerPath = process.env.DEVELOPER_PATH
  if (!developerPath) {
    return NextResponse.json({ error: "DEVELOPER_PATH is not configured." }, { status: 500 })
  }

  const body = await request.json()
  const safeName = String(body.name || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const fileName = `${timestamp}-${safeName}.md`
  const filePath = path.join(developerPath, "_system", "intake", fileName)

  const markdown = [
    `# Intake — ${body.name}`,
    "",
    "## Product identity",
    `- Name: ${body.name}`,
    `- Type: ${body.type}`,
    `- Value prop: ${body.valueProp}`,
    `- Target user: ${body.targetUser}`,
    "",
    "## Three-layer architecture",
    `- Data source: ${body.dataSource}`,
    `- AI role: ${body.aiRole}`,
    `- Output format: ${body.outputFormat}`,
    "",
    "## Scope",
    ...(body.mvpFeatures ?? []).filter(Boolean).map((item: string) => `- MVP: ${item}`),
    ...(body.outOfScope ?? []).filter(Boolean).map((item: string) => `- Out of scope: ${item}`),
    "",
    "## Stack",
    `- Mode: ${body.stackMode}`,
    `- Detail: ${body.stackMode === "default" ? "Next.js + Supabase + Vercel + Clerk" : body.customStack}`,
    "",
    "## Timeline",
    `- Launch target: ${body.launchTarget}`,
    `- Priority: ${body.priority}`,
    `- Business goal: ${body.businessGoal}`,
    "",
    "## Existing project",
    `- Existing project: ${body.existingProject ? "yes" : "no"}`,
    `- Repo folder: ${body.repoFolder}`,
    `- Current state: ${body.currentState}`,
    `- Phase: ${body.phase}`,
  ].join("\n")

  await fs.writeFile(filePath, markdown, "utf8")
  return NextResponse.json({ success: true, filePath })
}
