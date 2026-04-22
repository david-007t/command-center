import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getDeveloperPath } from "@/lib/orchestration"
import { getPortfolioPath, readPortfolioProjectsWithCommandCenter } from "@/lib/managed-projects"
import { promises as fs } from "fs"
import { getProjectStatus } from "@/lib/project-status"
import { readPortfolioFromStore } from "@/lib/runtime-store/phase1-store"
import { isSupabaseConfigured } from "@/lib/supabase/env"

export const dynamic = "force-dynamic"

function toneForRuntime(status: string) {
  if (/healthy/i.test(status)) return "green"
  if (/awaiting_ceo/i.test(status)) return "purple"
  if (/blocked/i.test(status)) return "red"
  if (/stale|timed_out/i.test(status)) return "amber"
  if (/cancelled/i.test(status)) return "neutral"
  return "amber"
}

export default async function ProjectsIndexPage() {
  if (isSupabaseConfigured()) {
    const stored = await readPortfolioFromStore().catch(() => null)
    if (stored) {
      return (
        <div className="space-y-8">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-sky-300">Projects</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Managed project directory</h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-400">
              Every managed project should be reachable from here, whether or not it is the currently active build.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {stored.projects.map((project) => (
              <Card key={project.name} className="flex h-full flex-col justify-between border-slate-800 bg-slate-950/70 p-5">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold text-white">{project.name}</h2>
                      <p className="mt-1 text-sm text-slate-400">{project.phase}</p>
                    </div>
                    <Badge tone={project.runtimeState ? (toneForRuntime(project.runtimeState.status) as never) : "neutral"}>
                      {project.runtimeState?.statusLabel ?? "No runtime state"}
                    </Badge>
                  </div>

                  <p className="text-sm text-slate-300">{project.nextAction}</p>
                  <p className="text-sm text-slate-500">{project.blocker || "No blocker recorded."}</p>
                </div>

                <div className="mt-5 flex flex-wrap gap-3 text-sm">
                  <Link className="text-sky-300 underline-offset-4 hover:underline" href={`/projects/${project.name}`}>
                    Open project
                  </Link>
                  <Link className="text-slate-500 underline-offset-4 hover:underline" href={`/projects/${project.name}/overview`}>
                    Overview
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )
    }
  }

  const developerPath = getDeveloperPath()
  const portfolioMarkdown = await fs.readFile(getPortfolioPath(developerPath), "utf8").catch(() => "")
  const projects = await readPortfolioProjectsWithCommandCenter(developerPath, portfolioMarkdown)
  const statuses = await Promise.all(
    projects.map(async (project) => ({
      project,
      status: await getProjectStatus(project.name).catch(() => null),
    })),
  )

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.4em] text-sky-300">Projects</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Managed project directory</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-400">
          Every managed project should be reachable from here, whether or not it is the currently active build.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {statuses.map(({ project, status }) => (
          <Card key={project.name} className="flex h-full flex-col justify-between border-slate-800 bg-slate-950/70 p-5">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">{project.name}</h2>
                  <p className="mt-1 text-sm text-slate-400">{project.phase}</p>
                </div>
                <Badge tone={status?.runtimeState ? (toneForRuntime(status.runtimeState.status) as never) : "neutral"}>
                  {status?.runtimeState?.statusLabel ?? "No runtime state"}
                </Badge>
              </div>

              <p className="text-sm text-slate-300">{project.nextAction}</p>
              <p className="text-sm text-slate-500">{project.blocker || "No blocker recorded."}</p>
            </div>

            <div className="mt-5 flex flex-wrap gap-3 text-sm">
              <Link className="text-sky-300 underline-offset-4 hover:underline" href={`/projects/${project.name}`}>
                Open project
              </Link>
              <Link className="text-slate-500 underline-offset-4 hover:underline" href={`/projects/${project.name}/overview`}>
                Overview
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
