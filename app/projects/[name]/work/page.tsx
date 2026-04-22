import { notFound } from "next/navigation"
import { ProjectOperator } from "@/components/project-operator"
import { loadProjectPageData } from "@/lib/project-page-data"

export const dynamic = "force-dynamic"

export default async function ProjectWorkPage({
  params,
}: {
  params: { name: string }
}) {
  try {
    const { projectStatus, tabs, runnerAvailable } = await loadProjectPageData(params.name)

    return (
      <div className="space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-sky-300">Project detail</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{params.name}</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-400">
            Chat is frozen for MVP. This view is the operating console: status, decisions, execution triggers, and persistent execution memory.
          </p>
        </div>
        <ProjectOperator projectName={params.name} initialProject={projectStatus} tabs={tabs} currentView="work" runnerAvailable={runnerAvailable} />
      </div>
    )
  } catch (error) {
    if (error instanceof Error && error.message === "DEVELOPER_PATH is not configured.") {
      return <div className="text-sm text-rose-300">DEVELOPER_PATH is not configured.</div>
    }

    notFound()
  }
}
