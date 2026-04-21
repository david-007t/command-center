import { redirect } from "next/navigation"

export default async function ProjectDetailPage({
  params,
}: {
  params: { name: string }
}) {
  redirect(`/projects/${params.name}/work`)
}
