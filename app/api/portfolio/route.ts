import { promises as fs } from "fs"
import path from "path"
import { NextResponse } from "next/server"
import { getPortfolioData } from "@/lib/portfolio-data"
import { getFastPortfolioFallback } from "@/lib/fast-portfolio-fallback"
import { getPortfolioPath } from "@/lib/managed-projects"
import { recordRuntimeEvent } from "@/lib/runtime-events"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get("full") === "1") {
    return NextResponse.json(await getPortfolioData())
  }

  return NextResponse.json(await getFastPortfolioFallback())
}

export async function POST(request: Request) {
  const developerPath = process.env.DEVELOPER_PATH
  if (!developerPath) {
    return NextResponse.json({ error: "DEVELOPER_PATH is not configured." }, { status: 500 })
  }

  const { projectName, action, reason } = await request.json()
  const portfolioPath = getPortfolioPath(developerPath)
  let portfolio = await fs.readFile(portfolioPath, "utf8")

  if (action === "ship") {
    portfolio = portfolio.replace(
      new RegExp(`\\| ${projectName} \\| ([^|]+) \\|`, "g"),
      `| ${projectName} | SHIP |`,
    )
  }

  if (action === "rebuild") {
    portfolio = portfolio.replace(
      new RegExp(`\\| ${projectName} \\| ([^|]+) \\|`, "g"),
      `| ${projectName} | BUILD |`,
    )

    const tasksPath = path.join(developerPath, projectName, "TASKS.md")
    const tasks = await fs.readFile(tasksPath, "utf8").catch(() => "")
    const appended = `${tasks}\n\n- [ ] CEO sent build back on 2026-04-14 — reason: ${reason}\n`
    await fs.writeFile(tasksPath, appended, "utf8")
  }

  await fs.writeFile(portfolioPath, portfolio, "utf8")
  await recordRuntimeEvent({
    eventType: "project_runtime_updated",
    projectName,
    scope: "portfolio",
    reason: "portfolio_update",
    title: action === "ship" ? "Portfolio updated for ship approval" : "Portfolio sent back to build",
    body: action === "ship" ? `${projectName} moved to SHIP.` : `${projectName} moved back to BUILD. ${reason ?? ""}`.trim(),
    payload: {
      action,
      reason: reason ?? null,
    },
  }).catch(() => null)
  return NextResponse.json({ message: `${projectName} updated.` })
}
