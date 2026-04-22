import { OperationsPageClient } from "@/components/operations-page-client"
import type { OperationsLiveData } from "@/lib/operations-live-data"

export default async function OperationsPage({
  searchParams,
}: {
  searchParams?: { project?: string; run?: string }
}) {
  const initialData: OperationsLiveData = {
    generatedAt: new Date().toISOString(),
    projects: [],
    activeRuns: [],
    recentRuns: [],
  }
  return <OperationsPageClient initialData={initialData} initialProject={searchParams?.project ?? null} initialRun={searchParams?.run ?? null} />
}
