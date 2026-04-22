import type { SupabaseArtifactRow } from "@/lib/inngest-run-store"

export type OperationsRunOutput = {
  runId: string
  generatedAt: string
  output: string
  source: "commentary" | "execution_log" | "message_preview" | "none"
  updatedAt: string | null
}

const OUTPUT_SOURCES: OperationsRunOutput["source"][] = ["commentary", "execution_log", "message_preview"]

function latestArtifact(artifacts: SupabaseArtifactRow[], artifactType: string) {
  return (
    artifacts
      .filter((artifact) => artifact.artifact_type === artifactType && artifact.content?.trim())
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null
  )
}

function tailLines(content: string, lineCount: number) {
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-lineCount)
    .join("\n")
}

export function buildOperationsRunOutput(
  runId: string,
  artifacts: SupabaseArtifactRow[],
  lineCount = 80,
  generatedAt = new Date().toISOString(),
): OperationsRunOutput {
  for (const source of OUTPUT_SOURCES) {
    const artifact = latestArtifact(artifacts, source)
    if (!artifact?.content) continue

    return {
      runId,
      generatedAt,
      output: tailLines(artifact.content, lineCount),
      source,
      updatedAt: artifact.created_at,
    }
  }

  return {
    runId,
    generatedAt,
    output: "",
    source: "none",
    updatedAt: null,
  }
}
