"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { executiveizeText } from "@/lib/executive"
import { publishRuntimeMutation } from "@/lib/runtime-sync"

type TabMap = Record<string, string>

function section(markdown: string, title: string) {
  return markdown.match(new RegExp(`## ${title}([\\s\\S]*?)(\\n## |$)`))?.[1]?.trim() ?? ""
}

function bulletList(content: string) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") || /^\d+\./.test(line))
    .slice(0, 5)
    .map((line) => line.replace(/^- /, "").replace(/^\d+\.\s*/, ""))
}

function summarizeTab(label: string, markdown: string) {
  if (label === "Overview") {
    return {
      title: "Product overview",
      summary: executiveizeText(section(markdown, "Product identity") || markdown, "No overview recorded yet."),
      bullets: bulletList(section(markdown, "MVP features — locked")),
    }
  }

  if (label === "Tasks") {
    return {
      title: "Execution plan",
      summary: executiveizeText(section(markdown, "Current sprint goal"), "No sprint goal recorded yet."),
      bullets: [
        ...bulletList(section(markdown, "In progress")),
        ...bulletList(section(markdown, "Blocked")),
        ...bulletList(section(markdown, "Up next")),
      ].slice(0, 6),
    }
  }

  if (label === "Last Handoff") {
    return {
      title: "Latest handoff",
      summary: executiveizeText(section(markdown, "What I actually did"), "No handoff summary recorded yet."),
      bullets: bulletList(section(markdown, "What the next agent should do first")),
    }
  }

  if (label === "Errors") {
    return {
      title: "Known issues",
      summary: executiveizeText(section(markdown, "Active errors"), "No active issues recorded."),
      bullets: bulletList(section(markdown, "Patterns — updated by Scout")),
    }
  }

  if (label === "Decisions") {
    return {
      title: "Key decisions",
      summary: executiveizeText(section(markdown, "Decision log"), "No major decisions recorded yet."),
      bullets: bulletList(section(markdown, "Dependency log")),
    }
  }

  if (label === "QA" || label === "Security") {
    return {
      title: label === "QA" ? "Quality gate" : "Security gate",
      summary: executiveizeText(markdown, `${label} summary not recorded yet.`),
      bullets: [],
    }
  }

  return {
    title: label,
    summary: executiveizeText(markdown, "No summary recorded yet."),
    bullets: [],
  }
}

export function ProjectTabs({
  projectName,
  tabs,
}: {
  projectName: string
  tabs: TabMap
}) {
  const router = useRouter()
  const labels = useMemo(() => Object.keys(tabs), [tabs])
  const [active, setActive] = useState(labels[0] ?? "Overview")
  const [reason, setReason] = useState("")
  const [status, setStatus] = useState("")
  const [showShipConfirm, setShowShipConfirm] = useState(false)
  const [showRaw, setShowRaw] = useState(false)

  async function updateProject(action: "ship" | "rebuild") {
    const response = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName, action, reason }),
    })
    const data = await response.json()
    setStatus(data.message ?? "Updated.")
    setShowShipConfirm(false)
    setReason("")
    router.refresh()
    publishRuntimeMutation({
      projectName,
      scope: "portfolio",
      reason: "portfolio_update",
    })
  }

  const currentSummary = summarizeTab(active, tabs[active] || "")

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          {labels.map((label) => (
            <Button key={label} variant={label === active ? "default" : "outline"} onClick={() => setActive(label)}>
              {label}
            </Button>
          ))}
        </div>
        <Button variant="ghost" onClick={() => setShowRaw((current) => !current)}>
          {showRaw ? "Hide raw document" : "Show raw document"}
        </Button>
      </div>

      <Card className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{currentSummary.title}</p>
          <p className="mt-3 text-sm leading-7 text-slate-200">{currentSummary.summary}</p>
        </div>
        {currentSummary.bullets.length ? (
          <div className="space-y-2">
            {currentSummary.bullets.map((item) => (
              <div key={item} className="rounded-lg border border-slate-800 p-3 text-sm text-slate-300">
                {executiveizeText(item)}
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {showRaw ? (
        <Card className="max-h-[65vh] overflow-y-auto">
          <p className="mb-4 text-xs uppercase tracking-[0.3em] text-slate-500">Raw governance document</p>
          <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-200">
            {tabs[active] || "No content found."}
          </pre>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setShowShipConfirm(true)}>Approve staging — ship it</Button>
        <Input
          className="max-w-md"
          placeholder="Reason to send back to build"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button variant="destructive" onClick={() => void updateProject("rebuild")} disabled={!reason.trim()}>
          Send back to build
        </Button>
      </div>

      {labels.length ? null : (
        <div className="text-sm text-slate-400">No governance documents are available for this project yet.</div>
      )}

      {showShipConfirm ? (
        <Card className="border-sky-500/40">
          <p className="text-sm text-slate-200">Confirm staging approval for {projectName}?</p>
          <div className="mt-4 flex gap-3">
            <Button onClick={() => void updateProject("ship")}>Confirm ship approval</Button>
            <Button variant="outline" onClick={() => setShowShipConfirm(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {status ? <p className="text-sm text-slate-400">{status}</p> : null}
    </div>
  )
}
