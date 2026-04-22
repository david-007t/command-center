import { NextResponse } from "next/server"
import { getDeveloperPath } from "@/lib/orchestration"
import { listFeedbackRecords } from "@/lib/feedback"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const developerPath = getDeveloperPath()
  const url = new URL(request.url)
  const projectName = url.searchParams.get("project")
  const feedback = await listFeedbackRecords(developerPath, 24)
  const scoped = projectName ? feedback.filter((item) => item.projectName === projectName || item.scope === "system") : feedback
  return NextResponse.json({
    feedback: scoped.slice(0, 12).map((item) => ({
      ...item,
      statusLabel:
        item.status === "actioning"
          ? "In progress"
          : item.status === "resolved"
            ? "Resolved"
            : item.status === "needs_decision"
              ? "Needs your decision"
              : "Logged",
      scopeLabel: item.scope === "system" ? "Command Center" : item.projectName ?? "Project",
    })),
  })
}
