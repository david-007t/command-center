"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { DailyScoutBrief } from "@/lib/scout-engine"

type ScoutData = {
  fileName: string
  newTools: Array<{ name: string; category: string; fit: string }>
  improvements: Array<{ file: string; currentText: string; proposedText: string }>
  revisit: Array<{ project: string; decisionId: string; revisitCondition: string; status: string }>
}

function toneForPriority(priority: string) {
  if (priority === "critical") return "red"
  if (priority === "important") return "amber"
  return "purple"
}

function toneForConfidence(confidence: string) {
  if (confidence === "confirmed") return "green"
  if (confidence === "inferred") return "amber"
  return "red"
}

export function ScoutReport({ reports, brief }: { reports: ScoutData[]; brief: DailyScoutBrief }) {
  const [status, setStatus] = useState("")

  async function approve(reportFile: string, improvement: { file: string; proposedText: string }) {
    const response = await fetch("/api/scout/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportFile, ...improvement }),
    })
    const data = await response.json()
    setStatus(data.message ?? "Updated scout item.")
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-5 border-sky-500/30">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-sky-300">Daily brief</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-100">{brief.headline}</h2>
          <p className="mt-2 text-sm text-slate-400">Generated {new Date(brief.generatedAt).toLocaleString()}</p>
        </div>
        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-100">Jarvis-style recommendations</h3>
          {brief.recommendations.map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-800 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={toneForPriority(item.priority) as never}>{item.priority}</Badge>
                <Badge tone={toneForConfidence(item.confidence) as never}>{item.confidence}</Badge>
                <p className="text-sm text-slate-400">{item.projectName ?? "portfolio"}</p>
              </div>
              <h4 className="mt-3 text-lg font-medium text-slate-100">{item.title}</h4>
              <p className="mt-2 text-sm text-slate-300">{item.summary}</p>
              <p className="mt-2 text-sm text-slate-400">Why now: {item.rationale}</p>
              <p className="mt-2 text-sm text-sky-300">Recommended move: {item.action}</p>
            </div>
          ))}
        </section>
        {brief.watchlist.length ? (
          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-slate-100">Watchlist</h3>
            {brief.watchlist.map((item) => (
              <div key={item} className="rounded-lg border border-slate-800 p-4 text-sm text-slate-300">
                {item}
              </div>
            ))}
          </section>
        ) : null}
      </Card>

      {reports.map((report) => (
        <Card key={report.fileName} className="space-y-6">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{report.fileName}</p>
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-100">New tools</h2>
            {report.newTools.map((tool, index) => (
              <div key={`${tool.name}-${index}`} className="rounded-lg border border-slate-800 p-4">
                <p className="font-medium text-slate-100">{tool.name}</p>
                <p className="text-sm text-slate-400">{tool.category}</p>
                <p className="mt-2 text-sm text-slate-300">{tool.fit}</p>
                <div className="mt-3 flex gap-3">
                  <Button variant="outline">Approve</Button>
                  <Button variant="ghost">Skip</Button>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-100">Governance improvements</h2>
            {report.improvements.map((item, index) => (
              <div key={`${item.file}-${index}`} className="rounded-lg border border-slate-800 p-4">
                <p className="font-medium text-slate-100">{item.file}</p>
                <p className="mt-2 text-sm text-slate-400">Current text</p>
                <pre className="mt-1 whitespace-pre-wrap rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-300">
                  {item.currentText}
                </pre>
                <p className="mt-3 text-sm text-slate-400">Proposed text</p>
                <pre className="mt-1 whitespace-pre-wrap rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-300">
                  {item.proposedText}
                </pre>
                <div className="mt-3 flex gap-3">
                  <Button onClick={() => void approve(report.fileName, item)}>Approve</Button>
                  <Button variant="destructive">Reject</Button>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-100">Decisions to revisit</h2>
            {report.revisit.map((item, index) => (
              <div key={`${item.project}-${index}`} className="rounded-lg border border-slate-800 p-4">
                <p className="font-medium text-slate-100">
                  {item.project} — {item.decisionId}
                </p>
                <p className="mt-2 text-sm text-slate-300">{item.revisitCondition}</p>
                <p className="mt-1 text-sm text-slate-500">{item.status}</p>
              </div>
            ))}
          </section>
        </Card>
      ))}
      {status ? <p className="text-sm text-slate-400">{status}</p> : null}
    </div>
  )
}
