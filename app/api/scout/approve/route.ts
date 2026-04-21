import { promises as fs } from "fs"
import path from "path"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const developerPath = process.env.DEVELOPER_PATH
  if (!developerPath) {
    return NextResponse.json({ error: "DEVELOPER_PATH is not configured." }, { status: 500 })
  }

  const { file, proposedText } = await request.json()
  const targetPath = path.join(developerPath, file)
  const changelogPath = path.join(developerPath, "CHANGELOG.md")

  await fs.writeFile(targetPath, proposedText, "utf8")

  const existing = await fs.readFile(changelogPath, "utf8").catch(() => "# CHANGELOG.md\n\n")
  const entry = `\n- 2026-04-14 — Scout approval applied to ${file}\n`
  await fs.writeFile(changelogPath, `${existing}${entry}`, "utf8")

  return NextResponse.json({ message: `Approved scout update for ${file}.` })
}
