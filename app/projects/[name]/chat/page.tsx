import { redirect } from "next/navigation"

export default async function ProjectChatPage({
  params,
}: {
  params: { name: string }
}) {
  redirect(`/projects/${params.name}/work`)
}
