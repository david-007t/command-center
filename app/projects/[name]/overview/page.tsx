import { notFound } from "next/navigation"
import { ProjectOperator } from "@/components/project-operator"
import { loadProjectPageData } from "@/lib/project-page-data"

export default async function ProjectOverviewPage({
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
        </div>
        <ProjectOperator projectName={params.name} initialProject={projectStatus} tabs={tabs} currentView="overview" runnerAvailable={runnerAvailable} />
      </div>
    )
  } catch (error) {
    if (error instanceof Error && error.message === "DEVELOPER_PATH is not configured.") {
      return <div className="text-sm text-rose-300">DEVELOPER_PATH is not configured.</div>
    }

    notFound()
  }
}
