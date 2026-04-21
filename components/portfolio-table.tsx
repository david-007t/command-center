"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"

type ProjectRow = {
  name: string
  phase: string
  progress: number
  blocker: string
  nextAction: string
  launchTarget: string
  runtimeState: {
    status: string
    statusLabel: string
    summary: string
  } | null
}

function toneForPhase(phase: string) {
  if (/blocked|critical/i.test(phase)) return "red"
  if (/build|active/i.test(phase)) return "green"
  if (/qa|review/i.test(phase)) return "amber"
  return "purple"
}

function toneForRuntime(status: string) {
  if (/healthy/i.test(status)) return "green"
  if (/awaiting_ceo/i.test(status)) return "purple"
  if (/blocked/i.test(status)) return "red"
  if (/stale|timed_out/i.test(status)) return "amber"
  if (/cancelled/i.test(status)) return "neutral"
  return "amber"
}

export function PortfolioTable({ projects }: { projects: ProjectRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <table className="min-w-full divide-y divide-slate-800 text-sm">
        <thead className="bg-slate-900/80 text-slate-300">
          <tr>
            <th className="px-4 py-3 text-left">Name</th>
            <th className="px-4 py-3 text-left">Phase</th>
            <th className="px-4 py-3 text-left">Progress</th>
            <th className="px-4 py-3 text-left">Recent state</th>
            <th className="px-4 py-3 text-left">Blocker</th>
            <th className="px-4 py-3 text-left">Next action</th>
            <th className="px-4 py-3 text-left">Launch target</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800 bg-slate-950/70">
          {projects.map((project) => (
            <tr key={project.name}>
              <td className="px-4 py-3">
                <Link className="text-slate-100 underline-offset-4 hover:underline" href={`/projects/${project.name}`}>
                  {project.name}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Badge tone={toneForPhase(project.phase) as never}>{project.phase}</Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-sky-400" style={{ width: `${project.progress}%` }} />
                  </div>
                  <span className="text-slate-300">{project.progress}%</span>
                </div>
              </td>
              <td className="px-4 py-3">
                {project.runtimeState ? (
                  <div className="space-y-1">
                    <Badge tone={toneForRuntime(project.runtimeState.status) as never}>{project.runtimeState.statusLabel}</Badge>
                    <p className="max-w-xs text-xs text-slate-500">{project.runtimeState.summary}</p>
                  </div>
                ) : (
                  <span className="text-slate-500">No recent system update</span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-400">{project.blocker || "None"}</td>
              <td className="px-4 py-3 text-slate-300">{project.nextAction}</td>
              <td className="px-4 py-3 text-slate-400">{project.launchTarget}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
